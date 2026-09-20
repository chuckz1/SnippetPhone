const config = {
	iceServers: [
		{
			urls: [
				"stun:34.55.201.219:3478",
				"turn:34.55.201.219:3478?transport=udp",
			],
			username: "testuser",
			credential: "testpassword",
		},
	],
};

export class WebRTCManager {
	constructor({ onStatus, onRemoteSnippet } = {}) {
		this.onStatus = onStatus || (() => {});
		this.onRemoteSnippet = onRemoteSnippet || (() => {});
		this.peer = null;
		this.dataChannel = null;
		this.signalingSocket = null;
		this.generatedOfferToken = "";
		this.generatedAnswerToken = "";
		this.audioContext = null;
		this.offerIceCandidates = [];
		this.answerIceCandidates = [];
		this.connectionStage = "idle";
	}

	setStatus(message) {
		this.onStatus(message);
		console.log(`[SnippetPhone] ${message}`);
	}

	logDebug(message, details = null) {
		const prefix = "[SnippetPhone Debug]";
		if (details !== null) {
			console.log(prefix, message, details);
			return;
		}

		console.log(prefix, message);
	}

	updateConnectionStage(stage, message) {
		this.connectionStage = stage;
		this.logDebug(`Connection stage: ${stage}`, message || "");
		if (message) {
			this.setStatus(message);
		}
	}

	/**
	 * Connect to the WebSocket signaling server and listen for offer/answer/candidate messages.
	 *
	 * @param {string} url - The signaling server URL.
	 * @returns {WebSocket} The active signaling socket.
	 */
	connectSignalingServer(url = "wss://toward-independence-cyber-bathroom.trycloudflare.com") {
		if (typeof WebSocket === "undefined") {
			this.updateConnectionStage(
				"browser-missing-websocket",
				"This browser does not support WebSockets. Signaling is unavailable.",
			);
			return null;
		}

		if (
			this.signalingSocket &&
			(this.signalingSocket.readyState === WebSocket.OPEN ||
				this.signalingSocket.readyState === WebSocket.CONNECTING)
		) {
			this.logDebug("Reusing existing signaling socket", url);
			return this.signalingSocket;
		}

		this.updateConnectionStage(
			"connecting-signaling",
			`Connecting to signaling server: ${url}`,
		);
		this.logDebug("Attempting signaling connection", url);

		const ws = new WebSocket(url);
		this.signalingSocket = ws;

		ws.onopen = () => {
			this.updateConnectionStage(
				"signaling-connected",
				"Signaling server found and connected.",
			);
			this.logDebug("WebSocket connected successfully", url);
		};

		ws.onerror = (event) => {
			this.updateConnectionStage(
				"signaling-error",
				"Unable to reach the signaling server. Check the URL and server status.",
			);
			this.logDebug("Signaling socket error", event);
		};

		ws.onclose = (event) => {
			this.updateConnectionStage(
				"signaling-closed",
				`Signaling server disconnected. Code: ${event.code}.`,
			);
			this.logDebug("Signaling socket closed", {
				code: event.code,
				reason: event.reason || "No reason provided",
				wasClean: event.wasClean,
			});
		};

		ws.onmessage = async (event) => {
			try {
				const msg = JSON.parse(event.data);
				if (!msg || !msg.type) {
					this.logDebug("Received signaling message without a type", msg);
					return;
				}

				this.logDebug(`Received signaling message: ${msg.type}`, msg);

				if (msg.type === "welcome") {
					this.updateConnectionStage(
						"signaling-ready",
						"Signaling server is ready for peer negotiation.",
					);
					return;
				}

				if (msg.type === "offer") {
					this.updateConnectionStage(
						"offer-received",
						"Remote offer received.",
					);
					await this.handleIncomingOffer(msg);
					return;
				}

				if (msg.type === "answer") {
					this.updateConnectionStage(
						"answer-received",
						"Remote answer received.",
					);
					await this.handleIncomingAnswer(msg);
					return;
				}

				if (msg.type === "candidate") {
					this.updateConnectionStage(
						"candidate-received",
						"Remote ICE candidate received.",
					);
					await this.handleIncomingCandidate(msg);
				}
			} catch (error) {
				console.error("Failed to parse signaling message:", error);
				this.setStatus("Received an invalid signaling payload.");
			}
		};

		return ws;
	}

	/**
	 * Send a JSON signaling payload to the connected server.
	 *
	 * @param {object} message - The signaling message to send.
	 * @returns {boolean} Whether the message was queued successfully.
	 */
	sendSignalingMessage(message) {
		const ws = this.signalingSocket;
		if (!ws || ws.readyState !== WebSocket.OPEN) {
			this.logDebug(
				"Cannot send signaling message; socket is not open",
				message,
			);
			return false;
		}

		this.logDebug("Sending signaling message", message);
		ws.send(JSON.stringify(message));
		return true;
	}

	/**
	 * Handle a remote offer arriving over signaling.
	 *
	 * @param {object} message - The incoming signaling payload.
	 */
	async handleIncomingOffer(message) {
		if (!message || !message.sdp) {
			return;
		}

		const peer = this.createPeerConnection();
		this.answerIceCandidates = [];
		await peer.setRemoteDescription(
			new RTCSessionDescription({ type: "offer", sdp: message.sdp }),
		);
		await this.applyCandidates(message.candidates || []);

		const answer = await peer.createAnswer();
		await peer.setLocalDescription(answer);
		await this.waitForIceGathering();

		const answerMessage = {
			type: "answer",
			sdp: peer.localDescription.sdp,
			candidates: this.answerIceCandidates.slice(),
		};

		this.generatedAnswerToken = JSON.stringify(
			{
				version: 1,
				type: "answer",
				sdp: peer.localDescription.sdp,
				candidates: this.answerIceCandidates.slice(),
			},
			null,
			2,
		);

		this.sendSignalingMessage(answerMessage);
		this.setStatus("Offer received. Answer sent over signaling.");
	}

	/**
	 * Handle a remote answer arriving over signaling.
	 *
	 * @param {object} message - The incoming signaling payload.
	 */
	async handleIncomingAnswer(message) {
		if (!message || !message.sdp) {
			return;
		}

		if (!this.peer) {
			this.setStatus("No active offer exists yet. Generate an offer first.");
			return;
		}

		await this.peer.setRemoteDescription(
			new RTCSessionDescription({ type: "answer", sdp: message.sdp }),
		);
		await this.applyCandidates(message.candidates || []);
		this.setStatus("Answer received. Call is connected.");
	}

	/**
	 * Handle a remote ICE candidate arriving over signaling.
	 *
	 * @param {object} message - The incoming candidate payload.
	 */
	async handleIncomingCandidate(message) {
		if (!this.peer || !message || !message.candidate) {
			return;
		}

		try {
			await this.peer.addIceCandidate(new RTCIceCandidate(message.candidate));
		} catch (error) {
			console.warn("Failed to add remote ICE candidate:", error);
		}
	}

	createPeerConnection() {
		if (this.peer) {
			return this.peer;
		}

		this.updateConnectionStage(
			"peer-creating",
			"Creating WebRTC peer connection.",
		);
		const peer = new RTCPeerConnection(config);
		this.peer = peer;

		peer.onsignalingstatechange = () => {
			this.logDebug("Peer signaling state changed", peer.signalingState);
			if (peer.signalingState === "stable") {
				this.updateConnectionStage(
					"signaling-stable",
					"Peer connection signaling is stable.",
				);
			}
		};

		peer.oniceconnectionstatechange = () => {
			this.logDebug("ICE connection state changed", peer.iceConnectionState);
			if (peer.iceConnectionState === "checking") {
				this.updateConnectionStage(
					"ice-checking",
					"Checking ICE connectivity.",
				);
			}
			if (peer.iceConnectionState === "connected") {
				this.updateConnectionStage(
					"ice-connected",
					"ICE connected. Peer-to-peer networking is ready.",
				);
			}
			if (peer.iceConnectionState === "failed") {
				this.updateConnectionStage(
					"ice-failed",
					"ICE connection failed. Check the TURN/STUN server and credentials.",
				);
			}
		};

		peer.onconnectionstatechange = () => {
			const { connectionState } = peer;
			this.logDebug("Peer connection state changed", connectionState);
			if (connectionState === "connected") {
				this.updateConnectionStage(
					"connected",
					"WebRTC connection established. VAD snippets can now flow.",
				);
			}
			if (connectionState === "failed") {
				this.updateConnectionStage(
					"failed",
					"Connection failed. Try generating a fresh token pair.",
				);
			}
			if (connectionState === "disconnected") {
				this.updateConnectionStage("disconnected", "Connection disconnected.");
			}
		};

		peer.onicecandidate = (event) => {
			if (!event.candidate) {
				return;
			}

			const candidate = {
				candidate: event.candidate.candidate,
				sdpMid: event.candidate.sdpMid,
				sdpMLineIndex: event.candidate.sdpMLineIndex,
				usernameFragment: event.candidate.usernameFragment,
			};

			if (peer.localDescription && peer.localDescription.type === "offer") {
				this.offerIceCandidates.push(candidate);
			} else if (
				peer.localDescription &&
				peer.localDescription.type === "answer"
			) {
				this.answerIceCandidates.push(candidate);
			}

			if (
				this.signalingSocket &&
				this.signalingSocket.readyState === WebSocket.OPEN
			) {
				this.logDebug("Local ICE candidate generated", candidate);
				this.sendSignalingMessage({
					type: "candidate",
					candidate,
				});
			}
		};

		peer.ondatachannel = (event) => {
			this.attachDataChannel(event.channel);
		};

		const channel = peer.createDataChannel("snippetphone");
		this.attachDataChannel(channel);

		return peer;
	}

	attachDataChannel(channel) {
		if (!channel) {
			return;
		}

		this.dataChannel = channel;
		channel.binaryType = "arraybuffer";

		channel.onopen = () => {
			this.setStatus("Data channel is open. VAD snippets can be sent.");
		};

		channel.onclose = () => {
			this.setStatus("Data channel closed.");
		};

		channel.onmessage = (event) => {
			const { data } = event;
			if (data instanceof ArrayBuffer) {
				this.playSnippet(data);
				return;
			}

			if (data instanceof Blob) {
				data.arrayBuffer().then((buffer) => this.playSnippet(buffer));
				return;
			}
		};
	}

	async sendSnippet(audioBuffer) {
		if (!this.dataChannel) {
			this.setStatus("No data channel is active yet.");
			return false;
		}

		if (this.dataChannel.readyState !== "open") {
			this.setStatus("The data channel is not ready yet.");
			return false;
		}

		this.dataChannel.send(audioBuffer);
		return true;
	}

	playSnippet(audioBuffer) {
		const AudioCtor = window.AudioContext || window.webkitAudioContext;
		if (!AudioCtor) {
			this.setStatus("This browser does not support Web Audio playback.");
			return;
		}

		if (!this.audioContext) {
			this.audioContext = new AudioCtor();
		}

		const pcm = new Int16Array(audioBuffer);
		const floatData = new Float32Array(pcm.length);

		for (let index = 0; index < pcm.length; index += 1) {
			floatData[index] = pcm[index] / 32768;
		}

		const audioBufferObject = this.audioContext.createBuffer(
			1,
			floatData.length,
			16000,
		);
		audioBufferObject.getChannelData(0).set(floatData);

		const source = this.audioContext.createBufferSource();
		source.buffer = audioBufferObject;
		source.connect(this.audioContext.destination);
		source.start();
		this.onRemoteSnippet(audioBufferObject);
	}

	waitForIceGathering() {
		return new Promise((resolve) => {
			const peer = this.peer;
			if (!peer) {
				resolve();
				return;
			}

			if (peer.iceGatheringState === "complete") {
				resolve();
				return;
			}

			const onStateChange = () => {
				if (peer.iceGatheringState === "complete") {
					peer.removeEventListener("icegatheringstatechange", onStateChange);
					resolve();
				}
			};

			peer.addEventListener("icegatheringstatechange", onStateChange);
		});
	}

	async applyCandidates(candidates = []) {
		const peer = this.peer;
		if (!peer || !candidates.length) {
			return;
		}

		for (const candidate of candidates) {
			try {
				await peer.addIceCandidate(new RTCIceCandidate(candidate));
			} catch (error) {
				console.warn("Failed to add ICE candidate:", error);
			}
		}
	}

	async generateOfferToken() {
		const peer = this.createPeerConnection();
		const offer = await peer.createOffer();
		await peer.setLocalDescription(offer);
		await this.waitForIceGathering();

		const token = {
			version: 1,
			type: "offer",
			sdp: peer.localDescription.sdp,
			candidates: this.offerIceCandidates.slice(),
		};

		this.generatedOfferToken = JSON.stringify(token, null, 2);
		this.sendSignalingMessage({
			type: "offer",
			sdp: peer.localDescription.sdp,
			candidates: this.offerIceCandidates.slice(),
		});
		return this.generatedOfferToken;
	}

	async processIncomingToken(rawText) {
		const tokenText = (rawText || "").trim();
		if (!tokenText) {
			this.setStatus("Paste a valid token before connecting.");
			return null;
		}

		let token;
		try {
			token = JSON.parse(tokenText);
		} catch (error) {
			this.setStatus("The pasted token is not valid JSON.");
			console.error(error);
			return null;
		}

		if (!token || !token.type || !token.sdp) {
			this.setStatus("The token is missing the required WebRTC information.");
			return null;
		}

		if (token.type === "offer") {
			const peer = this.createPeerConnection();
			this.answerIceCandidates = [];
			await peer.setRemoteDescription(
				new RTCSessionDescription({ type: "offer", sdp: token.sdp }),
			);
			await this.applyCandidates(token.candidates || []);

			const answer = await peer.createAnswer();
			await peer.setLocalDescription(answer);
			await this.waitForIceGathering();

			const answerToken = {
				version: 1,
				type: "answer",
				sdp: peer.localDescription.sdp,
				candidates: this.answerIceCandidates.slice(),
			};

			this.generatedAnswerToken = JSON.stringify(answerToken, null, 2);
			this.setStatus(
				"Answer token created. Copy it and send it back to the caller.",
			);
			return this.generatedAnswerToken;
		}

		if (token.type === "answer") {
			if (!this.peer) {
				this.setStatus(
					"No active offer exists yet. Generate an offer token first.",
				);
				return null;
			}

			await this.peer.setRemoteDescription(
				new RTCSessionDescription({ type: "answer", sdp: token.sdp }),
			);
			await this.applyCandidates(token.candidates || []);
			this.setStatus("Answer received. Call is connected.");
			return null;
		}

		this.setStatus("Unknown token type. Expected offer or answer.");
		return null;
	}

	async completeOfferWithAnswer(rawText) {
		const tokenText = (rawText || "").trim();
		if (!tokenText) {
			this.setStatus("Paste the answer token before completing the call.");
			return;
		}

		let token;
		try {
			token = JSON.parse(tokenText);
		} catch (error) {
			this.setStatus("The pasted answer token is not valid JSON.");
			console.error(error);
			return;
		}

		if (!token || !token.type || token.type !== "answer" || !token.sdp) {
			this.setStatus("The pasted answer token looks invalid.");
			return;
		}

		if (!this.peer) {
			this.setStatus(
				"There is no active offer to complete. Generate an offer first.",
			);
			return;
		}

		await this.peer.setRemoteDescription(
			new RTCSessionDescription({ type: "answer", sdp: token.sdp }),
		);
		await this.applyCandidates(token.candidates || []);
		this.setStatus("Answer applied. The call is now connected.");
	}
}
