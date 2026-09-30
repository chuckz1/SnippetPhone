export class CompressionManager {
	constructor({ onStatus = () => {}, onAudioReady = () => {} } = {}) {
		this.onStatus = onStatus;
		this.onAudioReady = onAudioReady;

		this.encoder = null;
		this.decoder = null;
		this.expectedPacketCount = 0;

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

	setExpectedPacketCount(count) {
		this.expectedPacketCount = count;
	}

	/**
	 * Add a single Opus packet to the decoder.
	 * Calls onAudioReady() when all packets have been decoded.
	 *
	 * @param {Uint8Array} packet - The Opus packet to decode.
	 */
	async addOpusPacket(packet) {
		if (!this.decoder) {
			this.setStatus("Decoder not initialized.");
			return;
		}

		// Lazy init decoded chunk storage
		if (!this._decodedChunks) {
			this._decodedChunks = [];
			this._receivedPackets = 0;
		}

		// Wrap packet into EncodedAudioChunk
		const chunk = new EncodedAudioChunk({
			type: this._receivedPackets === 0 ? "key" : "delta",
			timestamp: this._receivedPackets * 20000, // 20ms per Opus frame
			data: packet.buffer.slice(
				packet.byteOffset,
				packet.byteOffset + packet.byteLength,
			),
		});

		this._receivedPackets++;

		// Capture decoder output
		this._decodeCallback = (audioData) => {
			const frames = audioData.numberOfFrames;
			const pcm = new Float32Array(frames);

			audioData.copyTo(pcm, {
				planeIndex: 0,
				frameOffset: 0,
				frameCount: frames,
			});

			this._decodedChunks.push({
				pcm,
				sampleRate: audioData.sampleRate,
				channels: audioData.numberOfChannels,
			});

			audioData.close();
		};

		// Decode the chunk
		this.decoder.decode(chunk);

		// If we know how many packets to expect, check completion
		if (
			this.expectedPacketCount > 0 &&
			this._receivedPackets >= this.expectedPacketCount
		) {
			await this.decoder.flush();
			this.decoder.close();

			this.setStatus("All Opus packets decoded.");

			// Stitch PCM chunks into one AudioBuffer
			const totalFrames = this._decodedChunks.reduce(
				(sum, c) => sum + c.pcm.length,
				0,
			);

			const context = new AudioContext({ sampleRate: this.sampleRate });
			const finalBuffer = context.createBuffer(
				this.channels,
				totalFrames,
				this.sampleRate,
			);

			let offset = 0;
			for (const chunk of this._decodedChunks) {
				finalBuffer.copyToChannel(chunk.pcm, 0, offset);
				offset += chunk.pcm.length;
			}

			// Fire callback
			this.onAudioReady(finalBuffer);
		}
	}
}
