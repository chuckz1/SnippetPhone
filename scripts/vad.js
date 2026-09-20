/**
 * Wraps the VAD library and optionally streams captured PCM chunks during speech.
 *
 * Standard mode keeps the original library callback behavior where the final speech
 * segment is returned from the library. Streaming mode adds a separate capture loop
 * that records microphone audio while VAD is active and emits fixed-length chunks at
 * the configured interval.
 */
export class VADManager {
	constructor({
		mode = "standard",
		streamIntervalMs = 250,
		onSpeechStart,
		onSpeechEnd,
		onStreamChunk,
		onStatus,
	} = {}) {
		this.mode = mode === "streaming" ? "streaming" : "standard";
		this.streamIntervalMs = streamIntervalMs;
		this.onSpeechStart = onSpeechStart || (() => {});
		this.onSpeechEnd = onSpeechEnd || (() => {});
		this.onStreamChunk = onStreamChunk || (() => {});
		this.onStatus = onStatus || (() => {});
		this.vad = null;
		this.isRunning = false;
		this.isStreaming = false;
		this.audioContext = null;
		this.processor = null;
		this.stream = null;
		this.streamTimer = null;
		this.streamingBuffer = [];
	}

	setStatus(message) {
		this.onStatus(message);
	}

	floatToInt16(floatData) {
		const buffer = new Int16Array(floatData.length);
		for (let index = 0; index < floatData.length; index += 1) {
			const clamped = Math.max(-1, Math.min(1, floatData[index]));
			buffer[index] = Math.round(clamped * 32767);
		}
		return buffer;
	}

	startStreamCapture() {
		if (this.streamTimer) {
			return;
		}

		this.isStreaming = true;
		this.streamingBuffer = [];
		this.streamTimer = window.setInterval(() => {
			if (!this.isStreaming || this.streamingBuffer.length === 0) {
				return;
			}

			const chunk = new Float32Array(this.streamingBuffer);
			this.streamingBuffer = [];
			this.onStreamChunk(this.floatToInt16(chunk));
		}, this.streamIntervalMs);
	}

	stopStreamCapture() {
		this.isStreaming = false;
		this.streamingBuffer = [];
		if (this.streamTimer) {
			window.clearInterval(this.streamTimer);
			this.streamTimer = null;
		}
	}

	setupStreamingProcessor(stream) {
		if (this.processor && this.audioContext) {
			return;
		}

		const AudioCtor = window.AudioContext || window.webkitAudioContext;
		if (!AudioCtor) {
			throw new Error("This browser does not support the Web Audio API.");
		}

		this.audioContext = new AudioCtor();
		const source = this.audioContext.createMediaStreamSource(stream);
		const gain = this.audioContext.createGain();
		gain.gain.value = 0;
		this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

		source.connect(this.processor);
		this.processor.connect(gain);
		gain.connect(this.audioContext.destination);

		this.processor.onaudioprocess = (event) => {
			if (!this.isStreaming) {
				return;
			}

			const input = event.inputBuffer.getChannelData(0);
			this.streamingBuffer.push(...input);
		};
	}

	async startMic() {
		if (this.stream) {
			this.setStatus("Microphone is already active.");
			return this.stream;
		}

		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: true,
				video: false,
			});
			this.stream = stream;
			this.setStatus("Microphone access granted.");
			return stream;
		} catch (error) {
			console.error(error);
			this.setStatus(
				"Microphone access was blocked. Allow microphone access and try again.",
			);
			return null;
		}
	}

	async initVAD() {
		if (this.vad) {
			return this.vad;
		}

		if (!window.vad) {
			throw new Error("VAD library is not loaded.");
		}

		const stream = await this.startMic();
		if (!stream) {
			return null;
		}

		if (this.mode === "streaming") {
			this.setupStreamingProcessor(stream);
		}

		this.vad = await window.vad.MicVAD.new({
			onSpeechStart: () => {
				this.isRunning = true;
				if (this.mode === "streaming") {
					this.startStreamCapture();
				}
				this.onSpeechStart();
			},
			onSpeechEnd: (audio) => {
				this.isRunning = false;
				if (this.mode === "streaming") {
					this.stopStreamCapture();
					this.onSpeechEnd(null);
					return;
				}
				this.onSpeechEnd(audio);
			},
			onnxWASMBasePath:
				"https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/",
			baseAssetPath:
				"https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.31/dist/",
		});

		this.vad.start();
		return this.vad;
	}

	stop() {
		if (this.vad) {
			this.vad.stop();
			this.vad = null;
		}

		this.stopStreamCapture();

		if (this.processor) {
			this.processor.disconnect();
			this.processor = null;
		}

		if (this.audioContext) {
			this.audioContext.close();
			this.audioContext = null;
		}

		if (this.stream) {
			this.stream.getTracks().forEach((track) => track.stop());
			this.stream = null;
		}

		this.isRunning = false;
		this.isStreaming = false;
	}
}
