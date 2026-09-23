import { WebRTCManager } from "./webrtc.js";
import { VADManager } from "./vad.js";
import { SignalingManager } from "./signaling.js";
//test
const state = {
	webrtc: null,
	vad: null,
	signal: null,
};

// DOM elements for user interaction and status display.
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
const activeUsersList = document.getElementById("activeUsersList");

function setStatus(message) {
	statusLog.textContent = `${new Date().toLocaleTimeString()} - ${message}`;
}

/**
 * Render the list of active peers in the UI.
 *
 * This is intentionally left unconnected to the signaling flow for now,
 * so the UI can be styled and populated manually in a later step.
 *
 * @param {string[]} users - The usernames to display in the peer list.
 */
function populateUserList(users = []) {
	if (!activeUsersList) {
		return;
	}

	activeUsersList.innerHTML = "";

	if (!users.length) {
		activeUsersList.innerHTML =
			'<p class="empty-state">No active peers yet.</p>';
		return;
	}

	const list = document.createElement("ul");
	list.className = "user-list";

	users.forEach((username) => {
		const item = document.createElement("li");
		item.className = "user-item";

		const name = document.createElement("span");
		name.className = "user-name";
		name.textContent = username;

		const callButton = document.createElement("button");
		callButton.type = "button";
		callButton.className = "secondary call-user-btn";
		callButton.textContent = "Call";

		item.append(name, callButton);
		list.appendChild(item);
	});

	activeUsersList.appendChild(list);
}

function ensureManagers() {
	if (!state.webrtc) {
		state.webrtc = new WebRTCManager({
			onStatus: setStatus,
			onRemoteSnippet: () => {
				// Remote snippets are played through the WebRTC data channel callback and
				// do not require a separate audio element in the DOM.
			},
		});
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

	if (!state.signal) {
		state.signal = new SignalingManager({
			onStatus: setStatus,
			onUserUpdate: (users) => {
				populateUserList(users);
			},
			onAnswer: async (answer) => {
				// Trim any leading or trailing whitespace from the received answer token.
				const trimmedAnswer = answer.trim();

				//hand over to web rtc
				state.webrtc.processIncomingToken(trimmedAnswer);

				// also display the answer
				// answerInput.value = trimmedAnswer
			},
			onRestart: () => {
				setStatus("Signaling server requested a restart.");
			},
		});
	}
}

//#region Event Listeners

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
//#endregion

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

	// make sure all managers are initialized before proceeding.
	ensureManagers();

	// Initialize the VAD (Voice Activity Detection) system.
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

	// Initialize the webrtc manager as well.
	try {
		await state.webrtc.initWebRTC();
		setStatus(
			"WebRTC manager is ready. You can now send offer to the signaling server.",
		);
	} catch (error) {
		console.error(error);
		setStatus(
			"The WebRTC manager could not initialize. Check the browser console for details.",
		);
	}

	// Initialize the signaling manager if it hasn't been already.
	try {
		await state.signal.init(state.webrtc.generatedOfferToken);
		setStatus("Signaling manager is ready. You can now start a call.");
	} catch (error) {
		console.error(error);
		setStatus(
			"The signaling manager could not initialize. Check the browser console for details.",
		);
	}
}

initializeVAD();
