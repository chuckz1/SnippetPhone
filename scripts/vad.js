export class VADManager {
	constructor({ onSpeechStart, onSpeechEnd, onStatus } = {}) {
		this.onSpeechStart = onSpeechStart || (() => {});
		this.onSpeechEnd = onSpeechEnd || (() => {});
		this.onStatus = onStatus || (() => {});
		this.vad = null;
		this.isRunning = false;
		this.audioContext = null;
		this.processor = null;
		this.stream = null;
		this.inputSampleRate = 48000;
		this.muted = true;
	}

	setStatus(message) {
		this.onStatus(message);
	}

	resetManager() {
		this.vad = null;
		this.isRunning = false;
		this.audioContext = null;
		this.processor = null;
		this.stream = null;
		this.muted = true;
	}

	async startMic() {
		if (this.stream) {
			this.setStatus("Microphone is already active.");
			return this.stream;
		}

		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: TextTrackCueList,
				video: false,
			});
			this.stream = stream;
			const audioTrack = stream.getAudioTracks()[0];
			const settings = audioTrack?.getSettings?.() || {};
			console.log("Audio track settings:", settings);
			this.inputSampleRate = settings.sampleRate || 16000;
			console.log(
				"Input sample rate set to:",
				settings.sampleRate,
				"Effective inputSampleRate:",
				this.inputSampleRate,
			);
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

		this.vad = await window.vad.MicVAD.new({
			onSpeechStart: () => {
				if (this.muted) {
					return;
				}
				this.isRunning = true;
				this.onSpeechStart();
			},
			onSpeechEnd: (audio) => {
				this.testPlayAudio(audio);
				if (this.muted) {
					return;
				}
				this.isRunning = false;
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

	setMuted(enabled) {
		this.muted = enabled;
		return this.muted;
	}

	toggleMuted() {
		this.muted = !this.muted;
		return this.muted;
	}

	testPlayAudio(audioBuffer) {
		try {
			// Lazy init AudioContext
			if (!this.audioContext) {
				const AudioCtor = window.AudioContext || window.webkitAudioContext;
				this.audioContext = new AudioCtor({ sampleRate: 16000 });
			}

			// Resume if suspended (Chrome auto-suspends)
			if (this.audioContext.state === "suspended") {
				this.audioContext.resume();
			}

			// audioBuffer from VAD is Float32Array PCM @ 16kHz
			const floatData = audioBuffer;
			const frameCount = floatData.length;

			// Create AudioBuffer
			const buffer = this.audioContext.createBuffer(
				1, // mono
				frameCount,
				16000, // MicVAD sample rate
			);

			buffer.copyToChannel(floatData, 0);

			// Play it
			const source = this.audioContext.createBufferSource();
			source.buffer = buffer;
			source.connect(this.audioContext.destination);
			source.start();

			this.setStatus(`Played test audio (${frameCount} samples)`);
		} catch (err) {
			console.error("testPlayAudio error:", err);
			this.setStatus("Failed to play test audio");
		}
	}
}
