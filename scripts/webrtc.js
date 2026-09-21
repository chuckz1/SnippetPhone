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
	constructor({ onStatus = () => {}, onRemoteSnippet = () => {} } = {}) {
		this.onStatus = onStatus;
		this.onRemoteSnippet = onRemoteSnippet;
		this.peer = null;
		this.dataChannel = null;
		this.audioContext = null;
		this.offerIceCandidates = [];
		this.answerIceCandidates = [];
	}

	// Keeps the WebRTC manager independent from the signaling state machine.
	setStatus(message) {
		this.onStatus(message);
		console.log(`[SnippetPhone] ${message}`);
	}

	// Emits internal debug output without altering the signaling flow.
	logDebug(message, details = null) {
		const prefix = "[SnippetPhone Debug]";
		if (details !== null) {
			console.log(prefix, message, details);
			return;
		}

		console.log(prefix, message);
	}

	// Creates a single RTCPeerConnection and installs the data-channel callbacks.
	createPeerConnection() {
		if (this.peer) {
			return this.peer;
		}

		this.setStatus("Creating WebRTC peer connection.");
		const peer = new RTCPeerConnection(config);
		this.peer = peer;

		peer.onsignalingstatechange = () => {
			this.logDebug("Peer signaling state changed", peer.signalingState);
			if (peer.signalingState === "stable") {
				this.setStatus("Peer connection signaling is stable.");
			}
		};

		peer.oniceconnectionstatechange = () => {
			this.logDebug("ICE connection state changed", peer.iceConnectionState);
			if (peer.iceConnectionState === "checking") {
				this.setStatus("Checking ICE connectivity.");
			}
			if (peer.iceConnectionState === "connected") {
				this.setStatus("ICE connected. Peer-to-peer networking is ready.");
			}
			if (peer.iceConnectionState === "failed") {
				this.setStatus(
					"ICE connection failed. Check the TURN/STUN server and credentials.",
				);
			}
		};

		peer.onconnectionstatechange = () => {
			const { connectionState } = peer;
			this.logDebug("Peer connection state changed", connectionState);
			if (connectionState === "connected") {
				this.setStatus(
					"WebRTC connection established. VAD snippets can now flow.",
				);
			}
			if (connectionState === "failed") {
				this.setStatus(
					"Connection failed. Try generating a fresh offer and answer pair.",
				);
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

	// Binds the data channel to the audio snippet pipeline.
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

	// Publishes audio to the connected peer over the WebRTC data channel.
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

	// Plays an incoming PCM buffer through the browser audio pipeline.
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

	// Waits until the ICE agent has finished gathering candidates for the current description.
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

	// Applies a batch of received ICE candidates to the active peer connection.
	async applyCandidates(candidates = []) {
		const peer = this.peer;
		if (!peer || !candidates.length) {
			return;
		}

		for (const candidate of candidates) {
			try {
				const candidatePayload =
					candidate && typeof candidate === "object" && candidate.candidate
						? candidate
						: { candidate: candidate };
				await peer.addIceCandidate(new RTCIceCandidate(candidatePayload));
			} catch (error) {
				console.warn("Failed to add ICE candidate:", error);
			}
		}
	}

	// Generates a fresh offer payload with its gathered ICE candidates.
	async createOffer() {
		const peer = this.createPeerConnection();
		const offer = await peer.createOffer();
		await peer.setLocalDescription(offer);
		await this.waitForIceGathering();

		const payload = {
			type: "offer",
			sdp: peer.localDescription?.sdp || "",
			candidates: this.offerIceCandidates.slice(),
		};
		this.offerIceCandidates = [];
		return payload;
	}

	// Builds a local answer payload after a remote offer has been applied.
	async createAnswer() {
		const peer = this.createPeerConnection();
		const answer = await peer.createAnswer();
		await peer.setLocalDescription(answer);
		await this.waitForIceGathering();

		const payload = {
			type: "answer",
			sdp: peer.localDescription?.sdp || "",
			candidates: this.answerIceCandidates.slice(),
		};
		this.answerIceCandidates = [];
		return payload;
	}

	// Applies the remote offer and any ICE candidates that arrived with it.
	async setRemoteOffer(message) {
		if (!message || !message.sdp) {
			return null;
		}

		const peer = this.createPeerConnection();
		await peer.setRemoteDescription(
			new RTCSessionDescription({ type: "offer", sdp: message.sdp }),
		);
		await this.applyCandidates(message.candidates || []);
		return message;
	}

	// Applies the remote answer and any ICE candidates that arrived with it.
	async setRemoteAnswer(message) {
		if (!message || !message.sdp) {
			return null;
		}

		if (!this.peer) {
			this.setStatus("No active offer exists yet. Generate an offer first.");
			return null;
		}

		await this.peer.setRemoteDescription(
			new RTCSessionDescription({ type: "answer", sdp: message.sdp }),
		);
		await this.applyCandidates(message.candidates || []);
		this.setStatus("Answer received. The call is connected.");
		return message;
	}

	// Handles a remote offer payload from the signaling layer and creates the answer.
	async handleIncomingOffer(message) {
		if (!message || !message.sdp) {
			return null;
		}

		await this.setRemoteOffer(message);
		const answer = await this.createAnswer();
		this.setStatus("Offer received. Ready to send the answer.");
		return answer;
	}

	// Handles the answer payload returned by the signaling layer.
	async handleIncomingAnswer(message) {
		return this.setRemoteAnswer(message);
	}

	// Accepts a single ICE candidate object from the signaling layer.
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
}
