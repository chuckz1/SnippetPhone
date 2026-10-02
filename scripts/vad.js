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
				audio: true,
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
				// this.testPlayAudio(audio);
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
}
