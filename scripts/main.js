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
		state.signaling.connect().then((connected) => {
			if (connected) {
				console.log(
					"[Main] Signaling success callback fired. Starting automatic negotiation.",
				);
				state.webrtc.autoNegotiate();
			}
		});
	}

	if (!state.vad) {
		state.vad = new VADManager({
			mode: "streaming",
			streamIntervalMs: 250,
			onStatus: setStatus,
			onSpeechStart: () => {
				setVADIndicator(true);
				setStatus("Speech detected. Capturing VAD snippet.");
			},
			onSpeechEnd: () => {
				setVADIndicator(false);
				setStatus("Voice activity ended. Streaming stopped.");
			},
			onStreamChunk: async (audioChunk) => {
				if (!audioChunk || !audioChunk.buffer) {
					return;
				}

				const sent = await state.webrtc.sendSnippet(audioChunk.buffer);
				if (sent) {
					setStatus("Speech snippet sent over the WebRTC data channel.");
				}
			},
		});
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

initializeVAD();
