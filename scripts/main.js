import { WebRTCManager } from "./webrtc.js";
import { SignalManager } from "./signaling.js";
import { VADManager } from "./vad.js";

const state = {
	webrtc: null,
	vad: null,
	signaling: null,
};

const statusLog = document.getElementById("statusLog");
const vadIndicator = document.getElementById("vadIndicator");
const vadModeSelect = document.getElementById("vadModeSelect");

function setVADIndicator(active) {
	if (!vadIndicator) {
		return;
	}

	if (active) {
		vadIndicator.textContent = "Listening";
		vadIndicator.classList.remove("idle");
		vadIndicator.classList.add("active");
		return;
	}

	vadIndicator.textContent = "Idle";
	vadIndicator.classList.remove("active");
	vadIndicator.classList.add("idle");
}

function setStatus(message) {
	statusLog.textContent = `${new Date().toLocaleTimeString()} - ${message}`;
}

function createVADConfig(mode) {
	const config = {
		mode,
		streamIntervalMs: 250,
		onStatus: setStatus,
		onSpeechStart: () => {
			setVADIndicator(true);
			setStatus(
				mode === "streaming"
					? "Speech detected. Capturing VAD snippet."
					: "Speech detected. Capturing final VAD snippet.",
			);
		},
		onSpeechEnd: async (audioChunk) => {
			setVADIndicator(false);
			if (!audioChunk) {
				return;
			}

			const floatArray =
				audioChunk instanceof Float32Array
					? audioChunk
					: new Float32Array(audioChunk);

			const int16Array = new Int16Array(floatArray.length);
			for (let index = 0; index < floatArray.length; index += 1) {
				const clamped = Math.max(-1, Math.min(1, floatArray[index]));
				int16Array[index] = Math.round(clamped * 32767);
			}

			const buffer = int16Array.buffer;
			const sent = await state.webrtc.sendSnippet(buffer);
			if (sent) {
				setStatus("Speech snippet sent over the WebRTC data channel.");
			}
		},
	};

	if (mode === "streaming") {
		config.onSpeechEnd = () => {
			setVADIndicator(false);
			setStatus("Voice activity ended. Streaming stopped.");
		};
		config.onStreamChunk = async (audioChunk) => {
			if (!audioChunk || !audioChunk.buffer) {
				return;
			}

			const sent = await state.webrtc.sendSnippet(audioChunk.buffer);
			if (sent) {
				setStatus("Speech snippet sent over the WebRTC data channel.");
			}
		};
	}

	return config;
}

function ensureManagers() {
	if (!state.signaling) {
		state.signaling = new SignalManager({
			onStatus: setStatus,
			onOffer: (message) => {
				if (state.webrtc) {
					state.webrtc.handleIncomingOffer(message);
				}
			},
			onAnswer: (message) => {
				if (state.webrtc) {
					state.webrtc.handleIncomingAnswer(message);
				}
			},
			onCandidate: (message) => {
				if (state.webrtc) {
					state.webrtc.handleIncomingCandidate(message);
				}
			},
		});
	}

	if (!state.webrtc) {
		state.webrtc = new WebRTCManager({
			onStatus: setStatus,
			signalingManager: state.signaling,
			onRemoteSnippet: () => {
				// Remote snippets are played through the WebRTC data channel callback and
				// do not require a separate audio element in the DOM.
			},
		});
		console.log("[Main] Starting automatic negotiation without a reset.");
		state.signaling.autoNegotiate(state.webrtc);
	}

	if (!state.vad) {
		const mode = vadModeSelect ? vadModeSelect.value : "standard";
		state.vad = new VADManager(createVADConfig(mode));
	}
}

async function updateVADMode(mode) {
	if (!state.vad) {
		return;
	}

	if (state.vad) {
		state.vad.stop();
		state.vad = null;
	}

	state.vad = new VADManager(createVADConfig(mode));
	if (window.vad) {
		try {
			await state.vad.initVAD();
			setStatus(`VAD is ready in ${mode} mode.`);
		} catch (error) {
			console.error(error);
			setStatus("The VAD library could not initialize in the selected mode.");
		}
	}
}

setStatus(
	"Initializing the signaling and audio pipeline. The app will connect automatically.",
);

async function initializeVAD() {
	if (!window.vad) {
		setStatus(
			"VAD library is still loading. Please wait a moment and try again.",
		);
		return;
	}

	ensureManagers();
	try {
		await state.vad.initVAD();
		setStatus(
			"VAD is ready. Use the call flow to establish the WebRTC data channel.",
		);
	} catch (error) {
		console.error(error);
		setStatus(
			"The VAD library could not initialize. Check the browser console for details.",
		);
	}
}

if (vadModeSelect) {
	vadModeSelect.addEventListener("change", async (event) => {
		await updateVADMode(event.target.value);
	});
}

initializeVAD();
