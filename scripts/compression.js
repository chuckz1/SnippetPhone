export class CompressionManager {
	constructor({ onStatus = () => {} } = {}) {
		this.onStatus = onStatus;

		this.encoder = null;
		this.decoder = null;

		this.sampleRate = 48000;
		this.channels = 1;
		this.frameSize = 960; // standard Opus frame size
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
	 * Initialize encoder + decoder
	 */
	async initialize() {
		if (!("AudioEncoder" in window) || !("AudioDecoder" in window)) {
			throw new Error("WebCodecs AudioEncoder/AudioDecoder not supported.");
		}

		this.setStatus("Initializing Opus encoder/decoder…");

		// -----------------------
		// ENCODER
		// -----------------------
		this.encoder = new AudioEncoder({
			output: (chunk) => {
				// encoder output is handled inside compress()
				if (this._encodeCallback) {
					this._encodeCallback(chunk);
				}
			},
			error: (e) => console.error("Encoder error:", e),
		});

		this.encoder.configure({
			codec: "opus",
			sampleRate: this.sampleRate,
			numberOfChannels: this.channels,
			bitrate: 32000, // tweakable
		});

		// -----------------------
		// DECODER
		// -----------------------
		this.decoder = new AudioDecoder({
			output: (audioData) => {
				if (this._decodeCallback) {
					this._decodeCallback(audioData);
				}
			},
			error: (e) => console.error("Decoder error:", e),
		});

		this.decoder.configure({
			codec: "opus",
			sampleRate: this.sampleRate,
			numberOfChannels: this.channels,
		});

		this.setStatus("Opus encoder/decoder ready.");
	}

	/**
	 * Compress Int16Array PCM → array of Uint8Array Opus packets
	 *
	 * @param {Int16Array} int16Buffer - The PCM audio data to compress.
	 * @returns {Promise<Array.<Uint8Array>>} - The compressed audio data.
	 */
	async compress(int16Buffer) {
		if (!this.encoder) {
			this.setStatus("Encoder not initialized.");
			return null;
		}

		this.setStatus("Compression started");

		const packets = [];

		// Capture encoder output
		this._encodeCallback = (chunk) => {
			const packet = new Uint8Array(chunk.byteLength);
			chunk.copyTo(packet);
			packets.push(packet);
		};

		// Convert Int16 → Float32
		const float32 = new Float32Array(int16Buffer.length);
		for (let i = 0; i < int16Buffer.length; i++) {
			float32[i] = int16Buffer[i] / 32768;
		}

		// Feed frames
		for (let offset = 0; offset < float32.length; offset += this.frameSize) {
			const slice = float32.subarray(offset, offset + this.frameSize);

			const audioData = new AudioData({
				format: "f32",
				sampleRate: this.sampleRate,
				numberOfChannels: this.channels,
				numberOfFrames: slice.length,
				data: slice,
				timestamp: (offset / this.sampleRate) * 1_000_000,
			});

			this.encoder.encode(audioData);
			audioData.close();
		}

		await this.encoder.flush();

		this.setStatus("Compression completed");

		return packets; // array of Uint8Array
	}

	/**
	 * Decompress array of Uint8Array Opus packets → Float32Array PCM
	 *
	 * @param {Array.<Uint8Array>} encodedPackets - The compressed audio data to decompress.
	 * @returns {Promise<Float32Array>} - The decompressed PCM audio data.
	 */
	async decompress(encodedPackets) {
		if (!this.decoder) {
			this.setStatus("Decoder not initialized.");
			return null;
		}

		this.setStatus("Decompression started");

		const pcmChunks = [];

		this._decodeCallback = (audioData) => {
			// SAFELY allocate based on actual plane byteLength
			const plane = audioData.planes[0];
			const byteLength = plane.byteLength;

			const float32 = new Float32Array(byteLength / 4); // f32 = 4 bytes
			audioData.copyTo(float32, {
				planeIndex: 0,
				frameOffset: 0,
				frameCount: audioData.numberOfFrames,
			});

			pcmChunks.push(float32);
			audioData.close();
		};

		// Feed packets
		encodedPackets.forEach((packet, index) => {
			const chunk = new EncodedAudioChunk({
				type: index === 0 ? "key" : "delta",
				data: packet,
				timestamp: index * 20000,
			});

			this.decoder.decode(chunk);
		});

		await this.decoder.flush();

		this.setStatus("Decompression completed");

		// Concatenate PCM chunks
		const totalLength = pcmChunks.reduce((sum, arr) => sum + arr.length, 0);
		const output = new Float32Array(totalLength);

		let offset = 0;
		for (const chunk of pcmChunks) {
			output.set(chunk, offset);
			offset += chunk.length;
		}

		return output; // Float32Array PCM
	}
}
