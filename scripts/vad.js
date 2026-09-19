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
	}

	setStatus(message) {
		this.onStatus(message);
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

		this.vad = await window.vad.MicVAD.new({
			onSpeechStart: () => {
				this.isRunning = true;
				this.onSpeechStart();
			},
			onSpeechEnd: (audio) => {
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

	stop() {
		if (this.vad) {
			this.vad.stop();
			this.vad = null;
		}

		if (this.stream) {
			this.stream.getTracks().forEach((track) => track.stop());
			this.stream = null;
		}

		this.isRunning = false;
	}
}
