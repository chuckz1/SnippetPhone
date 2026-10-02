export class CompressionManager {
	constructor({ onStatus = () => {}, onAudioReady = () => {} } = {}) {
		this.onStatus = onStatus;
		this.onAudioReady = onAudioReady;

		this.encoder = null;
		this.decoder = null;

		this.sampleRate = 16000; // YOU control only this
		this.channels = 1;

		// Opus always uses 20ms frames
		this.frameSize = Math.floor(this.sampleRate * 0.02);

		this._decodedChunks = [];
		this._receivedPackets = 0;
		this.expectedPacketCount = 0;

		this._encodeCallback = null;
		this._decodeCallback = null;
	}

	setStatus(msg) {
		this.onStatus(msg);
	}

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
				if (this._encodeCallback) this._encodeCallback(chunk);
			},
			error: (e) => console.error("Encoder error:", e),
		});

		this.encoder.configure({
			codec: "opus",
			sampleRate: this.sampleRate,
			numberOfChannels: this.channels,
			bitrate: 32000,
		});

		// -----------------------
		// DECODER
		// -----------------------
		this.createDecoder();

		this.setStatus("Opus encoder/decoder ready.");
	}

	createDecoder() {
		if (this.decoder && this.decoder.state !== "closed") {
			this.decoder.close();
		}

		this.decoder = new AudioDecoder({
			output: (audioData) => {
				console.log("Decoded sample rate:", audioData.sampleRate);

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
	}

	async compress(int16Buffer) {
		if (!this.encoder) {
			this.setStatus("Encoder not initialized.");
			return null;
		}

		this.setStatus("Compression started");

		const packets = [];

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
		return packets;
	}

	async handleIncoming(type, data) {
		if (type === "opusPacket") {
			await this._addOpusPacket(new Uint8Array(data));
		} else if (type === "packetCount") {
			this.expectedPacketCount = data;
		}
	}

	async _addOpusPacket(packet) {
		if (!this.decoder) this.createDecoder();

		const chunk = new EncodedAudioChunk({
			type: this._receivedPackets === 0 ? "key" : "delta",
			timestamp: this._receivedPackets * 20_000, // 20ms frames
			data: packet,
		});

		this._receivedPackets++;

		this._decodeCallback = (audioData) => {
			const frames = audioData.numberOfFrames;
			const pcm = new Float32Array(frames);

			audioData.copyTo(pcm, { planeIndex: 0 });
			this._decodedChunks.push({ pcm, sampleRate: audioData.sampleRate });

			audioData.close();
		};

		this.decoder.decode(chunk);

		if (
			this.expectedPacketCount > 0 &&
			this._receivedPackets >= this.expectedPacketCount
		) {
			await this.decoder.flush();
			this.decoder.close();

			const decodedRate = this._decodedChunks[0].sampleRate;
			const totalFrames = this._decodedChunks.reduce(
				(sum, c) => sum + c.pcm.length,
				0,
			);

			const ctx = new AudioContext({ sampleRate: decodedRate });
			const finalBuffer = ctx.createBuffer(
				this.channels,
				totalFrames,
				decodedRate,
			);

			let offset = 0;
			for (const chunk of this._decodedChunks) {
				finalBuffer.copyToChannel(chunk.pcm, 0, offset);
				offset += chunk.pcm.length;
			}

			this._decodedChunks = [];
			this._receivedPackets = 0;
			this.expectedPacketCount = 0;
			this.createDecoder();

			this.onAudioReady(finalBuffer);
			this.playSnippet(finalBuffer);
		}
	}

	async playSnippet(audioBuffer) {
		if (this.muted) return;

		const AudioCtor = window.AudioContext || window.webkitAudioContext;
		if (!AudioCtor) {
			this.setStatus("Web Audio not supported.");
			return;
		}

		if (
			!this.audioContext ||
			this.audioContext.sampleRate !== audioBuffer.sampleRate
		) {
			this.audioContext = new AudioCtor({
				sampleRate: audioBuffer.sampleRate,
			});
		}

		if (this.audioContext.state === "suspended") {
			await this.audioContext.resume();
		}

		const source = this.audioContext.createBufferSource();
		source.buffer = audioBuffer;
		source.connect(this.audioContext.destination);
		source.start();
	}
}

// export class CompressionManager {
// 	constructor({ onStatus = () => {}, onAudioReady = () => {} } = {}) {
// 		this.onStatus = onStatus;
// 		this.onAudioReady = onAudioReady;

// 		this.encoder = null;
// 		this.decoder = null;
// 		this.expectedPacketCount = 0;
// 		this._decodedChunks = [];
// 		this._receivedPackets = 0;
// 		this._decodeCallback = null;

// 		this.sampleRate = 16000;
// 		// this.sampleRate = 32000;
// 		this.channels = 1;
// 		// this.frameSize = 960; // standard Opus frame size
// 		this.frameSize = this.sampleRate * 0.02; // 320 samples (for 20ms frames)
// 	}

// 	/**
// 	 * Send a status update to any listening callback.
// 	 *
// 	 * @param {string} message - Human-readable status message.
// 	 */
// 	setStatus(message) {
// 		this.onStatus(message);
// 	}

// 	createDecoder() {
// 		if (this.decoder && this.decoder.state !== "closed") {
// 			this.decoder.close();
// 		}

// 		this.decoder = new AudioDecoder({
// 			output: (audioData) => {
// 				console.log("Decoded audio sample rate:", audioData.sampleRate);

// 				if (this._decodeCallback) {
// 					this._decodeCallback(audioData);
// 				}
// 			},
// 			error: (e) => console.error("Decoder error:", e),
// 		});

// 		this.decoder.configure({
// 			codec: "opus",
// 			sampleRate: this.sampleRate,
// 			numberOfChannels: this.channels,
// 		});
// 	}

// 	/**
// 	 * Initialize encoder + decoder
// 	 */
// 	async initialize() {
// 		if (!("AudioEncoder" in window) || !("AudioDecoder" in window)) {
// 			throw new Error("WebCodecs AudioEncoder/AudioDecoder not supported.");
// 		}

// 		this.setStatus("Initializing Opus encoder/decoder…");

// 		// -----------------------
// 		// ENCODER
// 		// -----------------------
// 		this.encoder = new AudioEncoder({
// 			output: (chunk) => {
// 				// encoder output is handled inside compress()
// 				if (this._encodeCallback) {
// 					this._encodeCallback(chunk);
// 				}
// 			},
// 			error: (e) => console.error("Encoder error:", e),
// 		});

// 		this.encoder.configure({
// 			codec: "opus",
// 			sampleRate: this.sampleRate,
// 			numberOfChannels: this.channels,
// 			bitrate: 32000, // tweakable
// 		});

// 		// -----------------------
// 		// DECODER
// 		// -----------------------
// 		this.createDecoder();

// 		this.setStatus("Opus encoder/decoder ready.");
// 	}

// 	/**
// 	 * Compress Int16Array PCM → array of Uint8Array Opus packets
// 	 *
// 	 * @param {Int16Array} int16Buffer - The PCM audio data to compress.
// 	 * @returns {Promise<Array.<Uint8Array>>} - The compressed audio data.
// 	 */
// 	async compress(int16Buffer) {
// 		if (!this.encoder) {
// 			this.setStatus("Encoder not initialized.");
// 			return null;
// 		}

// 		this.setStatus("Compression started");

// 		const packets = [];

// 		// Capture encoder output
// 		this._encodeCallback = (chunk) => {
// 			const packet = new Uint8Array(chunk.byteLength);
// 			chunk.copyTo(packet);
// 			packets.push(packet);
// 		};

// 		// Convert Int16 → Float32
// 		const float32 = new Float32Array(int16Buffer.length);
// 		for (let i = 0; i < int16Buffer.length; i++) {
// 			float32[i] = int16Buffer[i] / 32768;
// 		}

// 		// Feed frames
// 		for (let offset = 0; offset < float32.length; offset += this.frameSize) {
// 			const slice = float32.subarray(offset, offset + this.frameSize);

// 			const audioData = new AudioData({
// 				format: "f32",
// 				sampleRate: this.sampleRate,
// 				numberOfChannels: this.channels,
// 				numberOfFrames: slice.length,
// 				data: slice,
// 				timestamp: (offset / this.sampleRate) * 1_000_000,
// 			});

// 			this.encoder.encode(audioData);
// 			audioData.close();
// 		}

// 		await this.encoder.flush();

// 		this.setStatus("Compression completed");

// 		return packets; // array of Uint8Array
// 	}

// 	async handleIncoming(type, data) {
// 		if (type === "opusPacket") {
// 			await this._addOpusPacket(new Uint8Array(data));
// 		} else if (type === "packetCount") {
// 			this._setExpectedPacketCount(data);
// 		} else {
// 			console.warn("Unknown incoming message type:", type);
// 		}
// 	}

// 	_setExpectedPacketCount(count) {
// 		this.expectedPacketCount = count;
// 	}

// 	/**
// 	 * Add a single Opus packet to the decoder.
// 	 * Calls onAudioReady() when all packets have been decoded.
// 	 *
// 	 * @param {Uint8Array} packet - The Opus packet to decode.
// 	 */
// 	async _addOpusPacket(packet) {
// 		if (!this.decoder) {
// 			this.createDecoder();
// 		}

// 		// Lazy init decoded chunk storage
// 		if (!this._decodedChunks) {
// 			this._decodedChunks = [];
// 			this._receivedPackets = 0;
// 		}

// 		// Wrap packet into EncodedAudioChunk
// 		const chunk = new EncodedAudioChunk({
// 			type: this._receivedPackets === 0 ? "key" : "delta",
// 			timestamp: this._receivedPackets * 20000, // 20ms per Opus frame
// 			data: packet.buffer.slice(
// 				packet.byteOffset,
// 				packet.byteOffset + packet.byteLength,
// 			),
// 		});

// 		this._receivedPackets++;

// 		// Capture decoder output
// 		this._decodeCallback = (audioData) => {
// 			const frames = audioData.numberOfFrames;
// 			const pcm = new Float32Array(frames);

// 			audioData.copyTo(pcm, {
// 				planeIndex: 0,
// 				frameOffset: 0,
// 				frameCount: frames,
// 			});

// 			this._decodedChunks.push({
// 				pcm,
// 				sampleRate: audioData.sampleRate,
// 				channels: audioData.numberOfChannels,
// 			});

// 			audioData.close();
// 		};

// 		console.log(
// 			"Waiting for more Opus packets. Received:",
// 			this._receivedPackets,
// 			"Expected:",
// 			this.expectedPacketCount,
// 		);

// 		// Decode the chunk
// 		this.decoder.decode(chunk);

// 		// If we know how many packets to expect, check completion
// 		if (
// 			this.expectedPacketCount > 0 &&
// 			this._receivedPackets >= this.expectedPacketCount
// 		) {
// 			console.log("All expected Opus packets received. Flushing decoder.");
// 			await this.decoder.flush();
// 			this.decoder.close();

// 			this.setStatus("All Opus packets decoded.");

// 			// Stitch PCM chunks into one AudioBuffer
// 			const totalFrames = this._decodedChunks.reduce(
// 				(sum, c) => sum + c.pcm.length,
// 				0,
// 			);

// 			const context = new AudioContext({ sampleRate: this.sampleRate });
// 			const finalBuffer = context.createBuffer(
// 				this.channels,
// 				totalFrames,
// 				this.sampleRate,
// 			);

// 			let offset = 0;
// 			for (const chunk of this._decodedChunks) {
// 				finalBuffer.copyToChannel(chunk.pcm, 0, offset);
// 				offset += chunk.pcm.length;
// 			}

// 			console.log("Final AudioBuffer created with total frames:", totalFrames);

// 			// Reset state for the next snippet so a later packet batch does not reuse
// 			// closed decoder state or stale packet totals.
// 			this._decodedChunks = [];
// 			this._receivedPackets = 0;
// 			this.expectedPacketCount = 0;
// 			this._decodeCallback = null;
// 			this.createDecoder();

// 			// Fire callback
// 			this.onAudioReady(finalBuffer);
// 			this.playSnippet(finalBuffer);
// 		}
// 	}

// 	/**
// 	 * Play a decoded snippet from the remote peer.
// 	 *
// 	 * The decoder already produces a valid AudioBuffer of floating-point PCM. Converting
// 	 * the AudioBuffer object itself into an Int16Array produces all-zero data, which is why
// 	 * the snippet sounds silent even though the Opus packets decode successfully.
// 	 *
// 	 * @param {AudioBuffer} audioBuffer - Decoded PCM audio ready to play.
// 	 */
// 	async playSnippet(audioBuffer) {
// 		if (this.muted) {
// 			return;
// 		}

// 		const AudioCtor = window.AudioContext || window.webkitAudioContext;
// 		if (!AudioCtor) {
// 			this.setStatus("This browser does not support Web Audio playback.");
// 			return;
// 		}

// 		if (!this.audioContext) {
// 			this.audioContext = new AudioCtor({ sampleRate: this.sampleRate });
// 		}

// 		if (this.audioContext.state === "suspended") {
// 			await this.audioContext.resume();
// 		}

// 		const channelData = audioBuffer.getChannelData(0);
// 		const _sampleRate = audioBuffer.sampleRate || this.sampleRate;
// 		console.log("Using sample rate for playback:", _sampleRate);
// 		const audioBufferObject = this.audioContext.createBuffer(
// 			1,
// 			channelData.length,
// 			_sampleRate,
// 		);
// 		audioBufferObject.getChannelData(0).set(channelData);

// 		console.log("Playing snippet with length:", channelData.length);

// 		const source = this.audioContext.createBufferSource();
// 		source.buffer = audioBufferObject;
// 		source.connect(this.audioContext.destination);
// 		source.start();
// 	}
// }
