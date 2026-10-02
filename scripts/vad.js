export class VADManager {
	constructor({
		onSpeechStart,
		onSpeechEnd,
		onStatus,
		onStreamingChunk,
		streamingInterval = 300,
	} = {}) {
		this.onSpeechStart = onSpeechStart || (() => {});
		this.onSpeechEnd = onSpeechEnd || (() => {});
		this.onStatus = onStatus || (() => {});
		this.onStreamingChunk = onStreamingChunk || (() => {});
		this.streamingInterval = streamingInterval;

		this.vad = null;
		this.isRunning = false;
		this.audioContext = null;
		this.workletNode = null;
		this.stream = null;
		this.inputSampleRate = 16000;
		this.muted = true;

		this.mode = "streaming";
		this.streamingBuffer = [];
		this.streamingTimer = null;
	}

	toggleMode() {
		this.mode = this.mode === "standard" ? "streaming" : "standard";

		if (this.mode === "streaming" && this.isRunning) {
			this.startStreamingRecorder();
		}

		if (this.mode === "standard") {
			this.stopStreamingRecorder();
		}

		return this.mode;
	}

	setStatus(message) {
		this.onStatus(message);
	}

	resetManager() {
		this.vad = null;
		this.isRunning = false;
		this.audioContext = null;
		this.workletNode = null;
		this.stream = null;
		this.muted = true;
		this.stopStreamingRecorder();
	}

	async startMic() {
		if (this.stream) return this.stream;

		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: true,
				video: false,
			});

			this.stream = stream;
			const audioTrack = stream.getAudioTracks()[0];
			const settings = audioTrack?.getSettings?.() || {};
			// this.inputSampleRate = settings.sampleRate || 16000;
			console.error("Input sample rate:", this.inputSampleRate);

			this.setStatus("Microphone access granted.");
			return stream;
		} catch (error) {
			console.error(error);
			this.setStatus("Microphone access was blocked.");
			return null;
		}
	}

	async initVAD() {
		if (this.vad) return this.vad;
		if (!window.vad) throw new Error("VAD library is not loaded.");

		const stream = await this.startMic();
		if (!stream) return null;

		this.vad = await window.vad.MicVAD.new({
			onSpeechStart: () => {
				// if (this.muted) return;

				console.log("Speech started.");

				this.isRunning = true;
				this.onSpeechStart();

				if (this.mode === "streaming") {
					this.startStreamingRecorder();
				}
			},

			onSpeechEnd: (audio) => {
				// if (this.muted) return;

				console.log("Speech ended.");

				this.isRunning = false;

				if (this.mode === "streaming") {
					this.flushFinalStreamingChunk();
					this.stopStreamingRecorder();
				} else {
					this.onSpeechEnd(audio);
				}
			},

			onnxWASMBasePath:
				"https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/",
			baseAssetPath:
				"https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.31/dist/",
		});

		this.vad.start();
		return this.vad;
	}

	// -----------------------------------------------------
	// STREAMING MODE — AudioWorklet implementation
	// -----------------------------------------------------

	async startStreamingRecorder() {
		if (!this.audioContext) {
			this.audioContext = new AudioContext({
				sampleRate: this.inputSampleRate,
			});
			console.error("AudioContext sample rate:", this.audioContext.sampleRate);
		}

		if (!this.audioContext.audioWorklet) {
			throw new Error("AudioWorklet not supported.");
		}

		if (!this.workletLoaded) {
			await this.audioContext.audioWorklet.addModule(
				"streaming-recorder-worklet.js",
			);
			this.workletLoaded = true;
		}

		if (!this.workletNode) {
			const source = this.audioContext.createMediaStreamSource(this.stream);

			this.workletNode = new AudioWorkletNode(
				this.audioContext,
				"streaming-recorder",
			);

			source.connect(this.workletNode);

			this.workletNode.port.onmessage = (event) => {
				const frame = event.data;
				this.streamingBuffer.push(frame);
			};
		}

		// Tell worklet to start sending frames
		this.workletNode.port.postMessage("start");

		// Reset buffer
		this.streamingBuffer = [];

		// Start interval if not running
		if (!this.streamingTimer) {
			this.streamingTimer = setInterval(() => {
				if (this.streamingBuffer.length === 0) return;

				const totalLength = this.streamingBuffer.reduce(
					(sum, arr) => sum + arr.length,
					0,
				);

				const chunk = new Float32Array(totalLength);
				let offset = 0;

				for (const arr of this.streamingBuffer) {
					chunk.set(arr, offset);
					offset += arr.length;
				}

				this.streamingBuffer = [];

				this.onStreamingChunk(chunk);
			}, this.streamingInterval);
		}
	}

	flushFinalStreamingChunk() {
		if (this.streamingBuffer.length === 0) return;

		const totalLength = this.streamingBuffer.reduce(
			(sum, arr) => sum + arr.length,
			0,
		);

		const chunk = new Float32Array(totalLength);
		let offset = 0;

		for (const arr of this.streamingBuffer) {
			chunk.set(arr, offset);
			offset += arr.length;
		}

		this.streamingBuffer = [];

		this.onStreamingChunk(chunk);
	}

	stopStreamingRecorder() {
		console.log("Stopping streaming recorder.");

		// Tell worklet to stop sending frames
		if (this.workletNode) {
			this.workletNode.port.postMessage("stop");
		}

		// Stop interval
		if (this.streamingTimer) {
			clearInterval(this.streamingTimer);
			this.streamingTimer = null;
		}

		// Clear buffer
		this.streamingBuffer = [];
	}

	// -----------------------------
	// MUTE CONTROL
	// -----------------------------
	setMuted(enabled) {
		this.muted = enabled;
		return this.muted;
	}

	toggleMuted() {
		this.muted = !this.muted;
		return this.muted;
	}
}
