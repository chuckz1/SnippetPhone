export class CompressionManager {
	constructor({ onStatus = () => {} } = {}) {
		this.onStatus = onStatus;
		this.initPromise = null;
		this.encoder = null;
		this.decoder = null;
		this.onEncodedChunk = null;
		this.onDecodedAudio = null;
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
	 * Initialize the compression manager.
	 */
	async initialize() {
		// Any initialization logic for the compression manager can go here
		console.log("CompressionManager initialized");
		if (this.initPromise) return this.initPromise;

		this.initPromise = new Promise(async (resolve, reject) => {
			try {
				this.encoder = new AudioEncoder({
					output: (chunk) => {
						// chunk is an EncodedAudioChunk
						if (this.onEncodedChunk) {
							this.onEncodedChunk(chunk);
						}
					},
					error: (e) => console.error("Encoder error:", e),
				});

				this.decoder = new AudioDecoder({
					output: (audioData) => {
						if (this.onDecodedAudio) {
							this.onDecodedAudio(audioData);
						}
					},
					error: (e) => console.error("Decoder error:", e),
				});

				this.encoder.configure({
					codec: "opus",
					sampleRate: 16000,
					numberOfChannels: 1,
					bitrate: 24000, // good for voice
				});

				this.decoder.configure({
					codec: "opus",
					sampleRate: 16000,
					numberOfChannels: 1,
				});

				this.setStatus("WebCodecs Opus encoder/decoder ready.");
				resolve();
			} catch (err) {
				console.error("WebCodecs init failed:", err);
				reject(err);
			}
		});

		return this.initPromise;
	}

	/**
	 * Compress the given data.
	 *
	 * @param {Int16Array} int16Buffer - The PCM audio data to compress.
	 * @returns {Promise<ArrayBuffer>} - The compressed audio data.
	 */
	async compress(int16Buffer) {
		if (!this.encoder) return null;

		console.log("Compression started");

		const audioData = new AudioData({
			format: "s16",
			sampleRate: 16000,
			numberOfChannels: 1,
			numberOfFrames: int16Buffer.length,
			timestamp: performance.now() * 1000,
			data: int16Buffer,
		});

		return new Promise((resolve) => {
			this.onEncodedChunk = (chunk) => {
				// Convert EncodedAudioChunk → ArrayBuffer
				const raw = new Uint8Array(chunk.byteLength);
				chunk.copyTo(raw);
				console.log("Compression completed");
				resolve(raw.buffer);
			};

			this.encoder.encode(audioData);
		});
	}

	/**
	 * Decompress the given data.
	 *
	 * @param {ArrayBuffer} encodedBuffer - The compressed audio data to decompress.
	 * @returns {Promise<ArrayBuffer>} - The decompressed PCM audio data.
	 */
	async decompress(encodedBuffer) {
		console.log("Decompression started");

		return new Promise((resolve) => {
			const chunk = new EncodedAudioChunk({
				type: "key",
				timestamp: performance.now() * 1000,
				data: new Uint8Array(encodedBuffer),
			});

			this.onDecodedAudio = (audioData) => {
				// SAFEST: use the actual PCM plane size
				const plane = audioData.planes[0];

				// plane.byteLength is ALWAYS correct
				const pcm = new Int16Array(plane.byteLength / 2);

				// Now copy safely
				audioData.copyTo(pcm, { planeIndex: 0 });

				console.log("Decompression completed");
				resolve(pcm.buffer);
			};

			this.decoder.decode(chunk);
		});
	}
}
