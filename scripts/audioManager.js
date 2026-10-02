export class AudioManager {
	constructor({ onStatus = () => {} } = {}) {
		this.onStatus = onStatus;
	}

	/**
	 * Send a status update to any listening callback.
	 *
	 * @param {string} message - Human-readable status message.
	 */
	setStatus(message) {
		this.onStatus(message);
	}

	/**
	 * Normalize the audio buffer to a Float32Array.
	 *
	 * @param {Float32Array|Array} audioBuffer - The audio buffer to normalize.
	 * @returns {Float32Array} - The normalized audio buffer.
	 */
	normalizeAudio(audioBuffer) {
		//handle different formats of audioBuffer
		if (audioBuffer instanceof Float32Array) {
			return audioBuffer;
		}
		if (Array.isArray(audioBuffer)) {
			return new Float32Array(audioBuffer);
		}
		// handle int16Array
		if (audioBuffer instanceof Int16Array) {
			const floatArray = new Float32Array(audioBuffer.length);
			for (let i = 0; i < audioBuffer.length; i += 1) {
				floatArray[i] = audioBuffer[i] / 32768;
			}
			return floatArray;
		}

		throw new Error("Unsupported audio buffer format.");
	}

	/**
	 * Play audio from a Float32Array PCM buffer.
	 *
	 * @param {Float32Array} audioBuffer - The audio buffer to play.
	 */
	playAudio(audioBuffer) {
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
			const floatData = this.normalizeAudio(audioBuffer);
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

			// Queue after any audio still playing, so calls play in order
			const now = this.audioContext.currentTime;
			const startTime = Math.max(now, this.nextStartTime || 0);
			source.start(startTime);
			this.nextStartTime = startTime + buffer.duration;

			// this.setStatus(
			// 	startTime > now
			// 		? `Queued audio (${frameCount} samples)`
			// 		: `Played test audio (${frameCount} samples)`,
			// );
		} catch (err) {
			console.error("testPlayAudio error:", err);
			this.setStatus("Failed to play test audio");
		}
	}
}
