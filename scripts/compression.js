export class CompressionManager {
	constructor({ onStatus = () => {}, mode = "mulaw" } = {}) {
		this.onStatus = onStatus;
		this.encoder = null;
		this.sampleRate = 16000; // match your VAD / audio pipeline
		this.channels = 1; // mono speech
		this.bitrate = 16000; // 16 kbps is a good starting point
		this.mode = mode;
	}

	/**
	 * Send a status update to any listening callback.
	 *
	 * @param {string} message - Human-readable status message.
	 */
	setStatus(message) {
		this.onStatus(message);
	}

	// -----------------------------
	// μ-LAW ENCODER
	// -----------------------------
	pcm16ToMulaw(int16) {
		const MULAW_MAX = 0x1fff;
		const MULAW_BIAS = 33;

		const out = new Uint8Array(int16.length);

		for (let i = 0; i < int16.length; i++) {
			let sample = int16[i];

			let sign = (sample >> 8) & 0x80;
			if (sign !== 0) sample = -sample;
			if (sample > MULAW_MAX) sample = MULAW_MAX;

			sample = sample + MULAW_BIAS;
			let exponent = Math.floor(Math.log(sample) / Math.log(2));
			let mantissa = (sample >> (exponent + 3)) & 0x0f;

			out[i] = ~(sign | (exponent << 4) | mantissa);
		}

		return out;
	}

	// -----------------------------
	// μ-LAW DECODER
	// -----------------------------
	mulawToPcm16(muLawBytes) {
		const out = new Int16Array(muLawBytes.length);

		for (let i = 0; i < muLawBytes.length; i++) {
			let mu = ~muLawBytes[i];
			let sign = mu & 0x80;
			let exponent = (mu >> 4) & 0x07;
			let mantissa = mu & 0x0f;

			let sample = ((mantissa << 3) + 0x84) << exponent;
			if (sign !== 0) sample = -sample;

			out[i] = sample;
		}

		return out;
	}

	// -----------------------------
	// DOWNSAMPLING (simple factor)
	// -----------------------------
	downsample(int16, factor = 3) {
		const out = new Int16Array(Math.floor(int16.length / factor));
		for (let i = 0; i < out.length; i++) {
			out[i] = int16[i * factor];
		}
		return out;
	}

	// -----------------------------
	// COMPRESSION ENTRY POINT
	// -----------------------------
	compressAudio(pcmInt16) {
		if (!pcmInt16 || pcmInt16.length === 0) {
			return null;
		}

		try {
			if (this.mode === "mulaw") {
				this.setStatus("Compressing with μ-law.");
				return this.pcm16ToMulaw(pcmInt16);
			}

			if (this.mode === "downsample-mulaw") {
				this.setStatus("Compressing with downsample + μ-law.");
				const down = this.downsample(pcmInt16, 3); // 48k → 16k
				return this.pcm16ToMulaw(down);
			}

			this.setStatus("Compression disabled, sending raw PCM.");
			return new Uint8Array(pcmInt16.buffer);
		} catch (error) {
			console.error("Compression failed:", error);
			this.setStatus("Compression failed, sending raw PCM.");
			return new Uint8Array(pcmInt16.buffer);
		}
	}

	// -----------------------------
	// DECOMPRESSION ENTRY POINT
	// -----------------------------
	decompressAudio(bytes) {
		if (!bytes || bytes.length === 0) {
			return null;
		}

		try {
			if (this.mode === "mulaw") {
				return this.mulawToPcm16(bytes);
			}

			if (this.mode === "downsample-mulaw") {
				const pcm = this.mulawToPcm16(bytes);
				// Upsampling is optional — you can play 16k directly.
				return pcm;
			}

			// Raw PCM fallback
			return new Int16Array(bytes.buffer);
		} catch (error) {
			console.error("Decompression failed:", error);
			this.setStatus("Decompression failed.");
			return null;
		}
	}

	resetManager() {
		// Nothing to reset for pure JS compression
	}
}
