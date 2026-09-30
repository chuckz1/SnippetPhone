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
	constructor({
		onStatus,
		onRemoteSnippet,
		onCallStarted,
		onCallEnded,
		decompressAudio,
	} = {}) {
		this.onStatus = onStatus || (() => {});
		this.onRemoteSnippet = onRemoteSnippet || (() => {});
		this.onCallStarted = onCallStarted || (() => {});
		this.onCallEnded = onCallEnded || ((gracefully) => {});
		this.decompressAudio = decompressAudio || ((data) => data);
		this.peer = null;
		this.dataChannel = null;
		this.generatedOfferToken = "";
		this.generatedAnswerToken = "";
		this.audioContext = null;
		this.offerIceCandidates = [];
		this.answerIceCandidates = [];
		this.muted = false;
		this.endingCall = false;
		this.hangupAwaitingAck = false;
		this.hangupAckTimer = null;
	}

	setStatus(message) {
		console.log("Status update:", message);
		this.onStatus(message);
	}

	sendControlMessage(payload) {
		if (!this.dataChannel || this.dataChannel.readyState !== "open") {
			return false;
		}

		try {
			this.dataChannel.send(JSON.stringify(payload));
			return true;
		} catch (error) {
			console.warn("Could not send control message:", error);
			return false;
		}
	}

	resetManager() {
		this.cleanupPeerConnection();
		this.muted = false;
		this.endingCall = false;
	}

	toggleMuted() {
		this.muted = !this.muted;
		return this.muted;
	}

	async initWebRTC() {
		if (!this.peer) {
			this.createPeerConnection();
		}

		// Generate an offer token after ensuring the peer connection exists.
		await this.generateOfferToken();
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

			this.onCallStarted();

			this.endingCall = false;
		};

		channel.onclose = () => {
			this.setStatus("Data channel closed.");
			this.onCallEnded(this.endingCall);
			this.endingCall = false;
		};

		channel.onmessage = async (event) => {
			const { data } = event;

			console.log("Received data on the data channel:", data);
			// console.log(
			// 	"Received data on the data channel (JSON parse attempt):",
			// 	JSON.parse(data),
			// );
			console.log("Type of received data:", typeof data);
			console.log("Is data an ArrayBuffer?", data instanceof ArrayBuffer);
			console.log("Is data a Blob?", data instanceof Blob);
			console.log("Is data a true string?", typeof data === "string");
			console.log("Is data a String?", typeof data == "string");

			// -------------------------------
			// 1. Control messages
			// -------------------------------
			if (typeof data === "string") {
				console.log("here 1");
				try {
					console.log("here 2");
					const message = JSON.parse(data);
					console.log("here 3");
					console.log("Received control message:", message);
					console.log("here 4");
					if (message && message.type === "hangup") {
						this.handleRemoteHangup(message);
						return;
					}
					console.log("here 5");

					if (message && message.type === "hangup_ack") {
						this.handleHangupAck(message);
						return;
					}
					console.log("here 6");

					if (message && message.type === "packetCount") {
						console.log("Expected packet count:", message.count);
						state.compressionManager.setExpectedPacketCount(message.count);
						return;
					}

					console.log(
						"Received unknown message type on the data channel:",
						message,
					);
				} catch (error) {
					console.error("Failed to parse data channel message as JSON:", error);
					// print the raw data for debugging purposes
					console.error("Raw data that failed to parse:", data);
					// Ignore non-JSON strings that are not control messages.
				}
			}

			// -------------------------------
			// 3. Raw PCM ArrayBuffer
			// -------------------------------
			if (data instanceof ArrayBuffer) {
				//these are individual Opus packets
				await state.compressionManager.addOpusPacket(new Uint8Array(data));
				return;
			}

			// -------------------------------
			// 4. Raw PCM Blob (legacy)
			// -------------------------------
			if (data instanceof Blob) {
				data.arrayBuffer().then((buffer) => this.playSnippet(buffer));
				return;
			}
		};
	}

	handleRemoteHangup(message = {}) {
		this.setStatus(
			message.reason === "remote_hangup"
				? "The other side ended the call."
				: "The call was ended by the other participant.",
		);

		console.log("Remote requested to hang up the call.");
		this.endingCall = true;

		if (!message.acknowledged) {
			this.sendControlMessage({
				type: "hangup_ack",
				reason: "acknowledged",
				sentAt: Date.now(),
			});
		}

		this.cleanupPeerConnection();
	}

	handleHangupAck(message = {}) {
		if (this.hangupAckTimer) {
			clearTimeout(this.hangupAckTimer);
			this.hangupAckTimer = null;
		}

		this.hangupAwaitingAck = false;
		this.endingCall = true;
		this.setStatus("The remote side confirmed the hang-up.");
		this.cleanupPeerConnection();
	}

	cleanupPeerConnection() {
		console.log("Cleaning up the peer connection.");
		if (this.hangupAckTimer) {
			clearTimeout(this.hangupAckTimer);
			this.hangupAckTimer = null;
		}

		this.hangupAwaitingAck = false;

		if (this.dataChannel && this.dataChannel.readyState !== "closed") {
			console.log("Closing the data channel if it is open.");
			this.dataChannel.close();
		}
		console.log("Data channel cleanup complete.");

		if (this.peer && this.peer.connectionState !== "closed") {
			console.log("Closing the peer connection if it is open.");
			this.peer.close();
		}
		console.log("peer connection cleanup complete.");

		this.dataChannel = null;
		this.peer = null;
		this.offerIceCandidates = [];
		this.answerIceCandidates = [];
		this.generatedOfferToken = "";
		this.generatedAnswerToken = "";
		this.muted = false;
		console.log("cleanup complete.");
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

	async playSnippet(audioBuffer) {
		if (this.muted) {
			return;
		}

		const AudioCtor = window.AudioContext || window.webkitAudioContext;
		if (!AudioCtor) {
			this.setStatus("This browser does not support Web Audio playback.");
			return;
		}

		if (!this.audioContext) {
			this.audioContext = new AudioCtor();
		}

		// // Decompress the received audio buffer before playback.
		// const pcmBuffer = await this.decompressAudio(audioBuffer);

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
			return false;
		} else {
			console.log("token text: ", tokenText);
		}

		let token;
		try {
			token = JSON.parse(tokenText);
		} catch (error) {
			this.setStatus("The pasted answer token is not valid JSON.");
			console.error(error);
			return false;
		}

		if (!token || !token.type || token.type !== "answer" || !token.sdp) {
			this.setStatus("The pasted answer token looks invalid.");
			return false;
		}

		if (!this.peer) {
			this.setStatus(
				"There is no active offer to complete. Generate an offer first.",
			);
			return false;
		}

		await this.peer.setRemoteDescription(
			new RTCSessionDescription({ type: "answer", sdp: token.sdp }),
		);
		await this.applyCandidates(token.candidates || []);
		this.setStatus("Answer applied. The call is now connected.");
		return true;
	}

	async hangUpCall() {
		if (!this.peer && !this.dataChannel) {
			this.setStatus("There is no active call to hang up.");
			return false;
		}

		console.log("Preparing to hang up the call.");
		this.endingCall = true;
		this.hangupAwaitingAck = true;

		this.sendControlMessage({
			type: "hangup",
			reason: "remote_hangup",
			sentAt: Date.now(),
		});

		this.setStatus(
			"Ending the call and waiting for the other side to confirm.",
		);

		if (this.hangupAckTimer) {
			clearTimeout(this.hangupAckTimer);
		}

		this.hangupAckTimer = window.setTimeout(() => {
			if (!this.hangupAwaitingAck) {
				return;
			}

			this.hangupAwaitingAck = false;
			this.setStatus(
				"The remote side did not confirm the hang-up in time. Closing locally.",
			);
			this.cleanupPeerConnection();
		}, 2000);

		return true;
	}
}
