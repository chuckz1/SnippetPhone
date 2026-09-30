export class CompressionManager {
	constructor({ onStatus = () => {}, mode = "downsample-mulaw" } = {}) {
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

	applyLowPass(int16, alpha = 0.1) {
		const out = new Int16Array(int16.length);
		let prev = 0;
		// const alpha = 0.1; // smoothing factor

		for (let i = 0; i < int16.length; i++) {
			prev = prev + alpha * (int16[i] - prev);
			out[i] = prev;
		}

		return out.buffer; // return ArrayBuffer
	}

	// ----------------------------------------------------
	// DOWNSAMPLING (simple factor)
	// ----------------------------------------------------
	downsample(int16, factor = 3) {
		if (!int16 || int16.length === 0) {
			console.log("No data to downsample.");
			return null;
		}

		//apply low-pass filter before downsampling
		const newInt16 = new Int16Array(this.applyLowPass(int16, 0.3));

		const out = new Int16Array(Math.floor(newInt16.length / factor));
		for (let i = 0; i < out.length; i++) {
			out[i] = newInt16[i * factor];
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

		const beforeSize = buffer.byteLength;

		try {
			const int16 = new Int16Array(buffer);

			let compressed;
			if (this.mode === "mulaw") {
				this.setStatus("Compressing with μ-law.");
				compressed = this.pcm16ToMulaw(int16);
			} else if (this.mode === "downsample-mulaw") {
				this.setStatus("Compressing with downsample + μ-law.");
				const downBuf = this.downsample(int16, 2);
				const down = new Int16Array(downBuf);
				compressed = this.pcm16ToMulaw(down);
			} else if (this.mode === "downsample") {
				this.setStatus("Compressing with downsample.");
				compressed = this.downsample(int16, 3);
			} else {
				this.setStatus("Compression disabled, sending raw PCM.");
				compressed = buffer;
			}

			const afterSize = compressed.byteLength;
			const percentDecrease =
				beforeSize === 0 ? 0 : (1 - afterSize / beforeSize) * 100;

			console.log(
				`Compression before: ${beforeSize} bytes (${(beforeSize / 1024).toFixed(2)} KB)`,
			);
			console.log(
				`Compression after: ${afterSize} bytes (${(afterSize / 1024).toFixed(2)} KB)`,
			);
			console.log(
				`Compression decrease: ${percentDecrease.toFixed(1)}% smaller`,
			);

			return compressed;
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
				const pcmBuf = this.mulawToPcm16(bytes);
				return {
					buffer: pcmBuf,
					sampleRate: 16000, // original PCM
				};
			}

			if (this.mode === "downsample-mulaw") {
				const bytes = new Uint8Array(buffer);
				const pcmBuf = this.mulawToPcm16(bytes);
				return {
					buffer: pcmBuf,
					sampleRate: 16000 / 2, // downsample-mulaw → 8 kHz
				};
			}

			if (this.mode === "downsample") {
				return {
					buffer: buffer,
					sampleRate: 16000 / 3, // downsample factor 3 → 16khz → 5333 Hz
				};
			}

			// RAW PCM (none)
			return {
				buffer: buffer,
				sampleRate: 16000, // original PCM
			};
		} catch (error) {
			console.error("Decompression failed:", error);
			this.setStatus("Decompression failed.");
			return null;
		}
	}
}
