class StreamingRecorder extends AudioWorkletProcessor {
	constructor() {
		super();
		this.recording = false;
		this.previous = null;

		this.port.onmessage = (event) => {
			if (event.data === "start") {
				this.recording = true;
				// Flush the buffered chunk so the start of audio isn't clipped
				if (this.previous) {
					this.port.postMessage(this.previous);
					this.previous = null;
				}
			}
			if (event.data === "stop") this.recording = false;
		};
	}

	process(inputs) {
		const input = inputs[0][0];
		if (!input) return true;

		const chunk = new Float32Array(input);
		if (this.recording) {
			this.port.postMessage(chunk);
		} else {
			this.previous = chunk;
		}
		return true;
	}
}

registerProcessor("streaming-recorder", StreamingRecorder);
