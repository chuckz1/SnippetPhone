export class CompressionManager {
	constructor({ onStatus = () => {}, mode = "downsample" } = {}) {
		this.onStatus = onStatus;
		this.mode = mode; // Default compression mode
	}

	/**
	 * Send a status update to any listening callback.
	 *
	 * @param {string} message - Human-readable status message.
	 */
	setStatus(message) {
		this.onStatus(message);
	}

	// ----------------------------------------------------
	// μ-LAW ENCODER
	// ----------------------------------------------------
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

		return out.buffer; // return ArrayBuffer
	}

	// ----------------------------------------------------
	// μ-LAW DECODER
	// ----------------------------------------------------
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

		return out.buffer; // return ArrayBuffer
	}

	// ----------------------------------------------------
	// DOWNSAMPLING (simple factor)
	// ----------------------------------------------------
	downsample(int16, factor = 3) {
		const out = new Int16Array(Math.floor(int16.length / factor));
		for (let i = 0; i < out.length; i++) {
			out[i] = int16[i * factor];
		}
		return out.buffer; // return ArrayBuffer
	}

	// ----------------------------------------------------
	// COMPRESS (ArrayBuffer → ArrayBuffer)
	// ----------------------------------------------------
	compress(buffer) {
		console.log("Compressing data with mode:", this.mode);

		if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) {
			console.log("No data to compress.");
			return null;
		}

		try {
			const int16 = new Int16Array(buffer);

			if (this.mode === "mulaw") {
				this.setStatus("Compressing with μ-law.");
				return this.pcm16ToMulaw(int16);
			}

			if (this.mode === "downsample-mulaw") {
				this.setStatus("Compressing with downsample + μ-law.");
				const downBuf = this.downsample(int16, 3);
				const down = new Int16Array(downBuf);
				return this.pcm16ToMulaw(down);
			}

			if (this.mode === "downsample") {
				this.setStatus("Compressing with downsample.");
				return this.downsample(int16, 3);
			}

			// RAW PCM (none)
			this.setStatus("Compression disabled, sending raw PCM.");
			return buffer;
		} catch (error) {
			console.error("Compression failed:", error);
			this.setStatus("Compression failed, sending raw PCM.");
			return buffer;
		}
	}

	// ----------------------------------------------------
	// DECOMPRESS (ArrayBuffer → ArrayBuffer)
	// ----------------------------------------------------
	decompress(buffer) {
		console.log("Decompressing data with mode:", this.mode);

		if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) {
			console.log("No data to decompress.");
			return null;
		}

		try {
			if (this.mode === "mulaw") {
				const bytes = new Uint8Array(buffer);
				return this.mulawToPcm16(bytes);
			}

			if (this.mode === "downsample-mulaw") {
				const bytes = new Uint8Array(buffer);
				return this.mulawToPcm16(bytes);
			}

			if (this.mode === "downsample") {
				return buffer; // already PCM16 @ 16kHz
			}

			// RAW PCM (none)
			return buffer;
		} catch (error) {
			console.error("Decompression failed:", error);
			this.setStatus("Decompression failed.");
			return null;
		}
	}
}
