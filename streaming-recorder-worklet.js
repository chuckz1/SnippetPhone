class StreamingRecorder extends AudioWorkletProcessor {
	constructor() {
		super();
		this.recording = false;

		this.port.onmessage = (event) => {
			if (event.data === "start") this.recording = true;
			if (event.data === "stop") this.recording = false;
		};
	}

	process(inputs) {
		if (!this.recording) return true;

		const input = inputs[0][0];
		if (input) {
			this.port.postMessage(new Float32Array(input));
		}
		return true;
	}
}

registerProcessor("streaming-recorder", StreamingRecorder);
