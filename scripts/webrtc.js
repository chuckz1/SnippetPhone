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
	}

	setStatus(message) {
		this.onStatus(message);
	}

	/**
	 * Connect to the WebSocket signaling server and listen for offer/answer/candidate messages.
	 *
	 * @param {string} url - The signaling server URL.
	 * @returns {WebSocket} The active signaling socket.
	 */
	connectSignalingServer(url = "ws://34.55.201.219:8080") {
		if (
			this.signalingSocket &&
			(this.signalingSocket.readyState === WebSocket.OPEN ||
				this.signalingSocket.readyState === WebSocket.CONNECTING)
		) {
			return this.signalingSocket;
		}

		const ws = new WebSocket(url);
		this.signalingSocket = ws;

		ws.onopen = () => {
			this.setStatus("Connected to signaling server.");
		};

		ws.onclose = () => {
			this.setStatus("Signaling server disconnected.");
		};

		ws.onmessage = async (event) => {
			try {
				const msg = JSON.parse(event.data);
				if (!msg || !msg.type) {
					return;
				}

				if (msg.type === "welcome") {
					return;
				}

				if (msg.type === "offer") {
					await this.handleIncomingOffer(msg);
					return;
				}

				if (msg.type === "answer") {
					await this.handleIncomingAnswer(msg);
					return;
				}

				if (msg.type === "candidate") {
					await this.handleIncomingCandidate(msg);
				}
			} catch (error) {
				console.error("Failed to parse signaling message:", error);
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
			return false;
		}

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

		const peer = new RTCPeerConnection(config);
		this.peer = peer;

		peer.onconnectionstatechange = () => {
			const { connectionState } = peer;
			if (connectionState === "connected") {
				this.setStatus(
					"WebRTC connection established. VAD snippets can now flow.",
				);
			}
			if (connectionState === "failed") {
				this.setStatus("Connection failed. Try generating a fresh token pair.");
			}
			if (connectionState === "disconnected") {
				this.setStatus("Connection disconnected.");
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
