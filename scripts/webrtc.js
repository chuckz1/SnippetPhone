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
		this.signalingServerUrl =
			"https://script.google.com/macros/s/AKfycbzrDW6pei-ZNnki1AdPZBVxg3WbckDUhAphOHN2NbNgpUSHlvCkAwg7c53YXDreVesQhg/exec";
		this.signalingPollTimer = null;
		this.lastOfferSignature = "";
		this.lastAnswerSignature = "";
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
	 * Connect to the signaling server and start polling for stored offer/answer/candidate data.
	 *
	 * @param {string} url - The server URL that stores signaling state.
	 * @returns {number|null} The polling timer handle, if started.
	 */
	connectSignalingServer(url = this.signalingServerUrl) {
		this.signalingServerUrl = url;
		this.updateConnectionStage(
			"connecting-signaling",
			`Connecting to signaling server: ${url}`,
		);
		this.logDebug("Attempting signaling connection", url);

		if (this.signalingPollTimer) {
			return this.signalingPollTimer;
		}

		this.startSignalingPolling();
		this.verifySignalingServer()
			.then(() => {
				this.updateConnectionStage(
					"signaling-connected",
					"Signaling server found and connected.",
				);
			})
			.catch((error) => {
				console.warn("Signaling server verification failed:", error);
				this.updateConnectionStage(
					"signaling-error",
					"Unable to reach the signaling server. Check the URL and server status.",
				);
			});
		return this.signalingPollTimer;
	}

	async verifySignalingServer() {
		const result = await this.fetchSignal("offer");
		this.logDebug("Signaling server responded", result);
		return result;
	}

	startSignalingPolling() {
		if (this.signalingPollTimer) {
			return;
		}

		this.pollSignalingState();
		this.signalingPollTimer = setInterval(() => {
			this.pollSignalingState();
		}, 1000);
	}

	async fetchSignal(action) {
		const url = `${this.signalingServerUrl}?action=${encodeURIComponent(action)}`;
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Signal fetch failed for ${action}: ${response.status}`);
		}

		const text = await response.text();
		if (!text) {
			return {};
		}

		try {
			return JSON.parse(text);
		} catch (error) {
			console.warn(`Non-JSON response for ${action}:`, text);
			return {};
		}
	}

	async sendSignalingMessage(message) {
		this.logDebug("Sending signaling message", message);
		const response = await fetch(this.signalingServerUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(message),
		});

		if (!response.ok) {
			throw new Error(`Signal POST failed: ${response.status}`);
		}

		const text = await response.text();
		this.logDebug("Signal stored successfully", text);
		return text;
	}

	async pollSignalingState() {
		try {
			const offerData = await this.fetchSignal("offer");
			const offerSignature = JSON.stringify(offerData.offer || null);
			if (offerData.offer && offerSignature !== this.lastOfferSignature) {
				this.lastOfferSignature = offerSignature;
				if (!this.peer || !this.peer.remoteDescription) {
					this.updateConnectionStage(
						"offer-received",
						"Remote offer received.",
					);
					await this.handleIncomingOffer({ sdp: offerData.offer });
				}
			}

			const answerData = await this.fetchSignal("answer");
			const answerSignature = JSON.stringify(answerData.answer || null);
			if (answerData.answer && answerSignature !== this.lastAnswerSignature) {
				this.lastAnswerSignature = answerSignature;
				if (this.peer) {
					this.updateConnectionStage(
						"answer-received",
						"Remote answer received.",
					);
					await this.handleIncomingAnswer({ sdp: answerData.answer });
				}
			}

			const localDescriptionType =
				this.peer && this.peer.localDescription
					? this.peer.localDescription.type
					: null;

			if (localDescriptionType === "offer") {
				const remoteCandidates = await this.fetchSignal("candidatesB");
				const candidates = remoteCandidates.candidates || [];
				for (const candidate of candidates) {
					await this.handleIncomingCandidate({ candidate });
				}
			}

			if (localDescriptionType === "answer") {
				const remoteCandidates = await this.fetchSignal("candidatesA");
				const candidates = remoteCandidates.candidates || [];
				for (const candidate of candidates) {
					await this.handleIncomingCandidate({ candidate });
				}
			}
		} catch (error) {
			console.warn("Failed to poll signaling state:", error);
			this.updateConnectionStage(
				"signaling-error",
				"Unable to reach the signaling server. Check the URL and server status.",
			);
		}
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

		this.sendSignalingMessage({
			type: "answer",
			sdp: peer.localDescription.sdp,
		}).catch((error) => {
			console.warn("Failed to store answer on signaling server:", error);
		});
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

			const remoteCandidateType =
				peer.localDescription && peer.localDescription.type === "offer"
					? "candidateA"
					: "candidateB";

			if (this.signalingServerUrl) {
				this.logDebug("Local ICE candidate generated", candidate);
				this.sendSignalingMessage({
					type: remoteCandidateType,
					candidate,
				}).catch((error) => {
					console.warn("Failed to store ICE candidate:", error);
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
		}).catch((error) => {
			console.warn("Failed to store offer on signaling server:", error);
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
