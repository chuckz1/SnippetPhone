import { WebRTCManager } from "./webrtc.js";
import { SignalManager } from "./signaling.js";
import { VADManager } from "./vad.js";

const state = {
	webrtc: null,
	vad: null,
	signaling: null,
};

const startMicBtn = document.getElementById("startMicBtn");
const createOfferBtn = document.getElementById("createOfferBtn");
const copyOfferBtn = document.getElementById("copyOfferBtn");
const connectBtn = document.getElementById("connectBtn");
const copyAnswerBtn = document.getElementById("copyAnswerBtn");
const completeCallBtn = document.getElementById("completeCallBtn");
const offerInput = document.getElementById("offerInput");
const answerInput = document.getElementById("answerInput");
const statusLog = document.getElementById("statusLog");
const remoteAudio = document.getElementById("remoteAudio");

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
		state.signaling.connect();
	}

	if (!state.vad) {
		state.vad = new VADManager({
			onStatus: setStatus,
			onSpeechStart: () => {
				setStatus("Speech detected. Capturing VAD snippet.");
			},
			onSpeechEnd: async (audioChunk) => {
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
		});
	}
}

async function startMicrophone() {
	ensureManagers();
	await state.vad.startMic();
}

async function generateOfferToken() {
	ensureManagers();
	await state.vad.startMic();
	state.webrtc.createPeerConnection();
	const token = await state.webrtc.generateOfferToken();
	offerInput.value = "";
	setStatus("Offer token generated. Copy it and send it to the second client.");
	return token;
}

async function processIncomingToken() {
	ensureManagers();
	await state.vad.startMic();
	const rawText = offerInput.value.trim();
	const token = await state.webrtc.processIncomingToken(rawText);
	if (token) {
		answerInput.value = "";
	}
	return token;
}

async function completeOfferWithAnswer() {
	ensureManagers();
	const rawText = answerInput.value.trim();
	await state.webrtc.completeOfferWithAnswer(rawText);
}

async function copyToClipboard(value) {
	if (!value) {
		setStatus("There is nothing to copy yet.");
		return;
	}

	try {
		await navigator.clipboard.writeText(value);
		setStatus("Copied to clipboard.");
	} catch (error) {
		console.error(error);
		setStatus("Clipboard access failed. You can copy the text manually.");
	}
}

async function copyGeneratedOffer() {
	ensureManagers();
	if (!state.webrtc.generatedOfferToken) {
		setStatus("Generate an offer token first.");
		return;
	}

	await copyToClipboard(state.webrtc.generatedOfferToken);
}

async function copyGeneratedAnswer() {
	ensureManagers();
	if (!state.webrtc.generatedAnswerToken) {
		setStatus("Generate an answer token first.");
		return;
	}

	await copyToClipboard(state.webrtc.generatedAnswerToken);
}

startMicBtn.addEventListener("click", async () => {
	await startMicrophone();
});

createOfferBtn.addEventListener("click", async () => {
	await generateOfferToken();
});

copyOfferBtn.addEventListener("click", async () => {
	await copyGeneratedOffer();
});

connectBtn.addEventListener("click", async () => {
	await processIncomingToken();
});

copyAnswerBtn.addEventListener("click", async () => {
	await copyGeneratedAnswer();
});

completeCallBtn.addEventListener("click", async () => {
	await completeOfferWithAnswer();
});

setStatus(
	"Ready to start a call. Generate an offer, copy it, transfer it manually, then complete the call with the answer token.",
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
