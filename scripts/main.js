import { WebRTCManager } from "./webrtc.js";
import { VADManager } from "./vad.js";
import { SignalingManager } from "./signaling.js";
import { UserManager } from "./userManager.js";
import { FastConnectionManager } from "./fastConnection.js";

const state = {
	webrtc: null,
	vad: null,
	signal: null,
	userManager: null,
	fastConnectionManager: null,
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
const userNameForm = document.getElementById("userNameForm");
const userNameInput = document.getElementById("currentUserName");
const userNameDisplay = document.getElementById("currentUserNameDisplay");
const clearUserNameBtn = document.getElementById("clearUserNameBtn");
const shareFastTextBtn = document.getElementById("shareFastTextBtn");
const shareFastEmailBtn = document.getElementById("shareFastEmailBtn");

const step1 = document.getElementById("Step1");
const step2 = document.getElementById("Step2");

function setStatus(message) {
	statusLog.textContent = `${new Date().toLocaleTimeString()} - ${message}`;
}

function setStepVisibility(stepIndex) {
	step1.hidden = stepIndex !== 1;
	step2.hidden = stepIndex !== 2;

	//this switch if for activities that should happen whenever switching to a new step
	switch (stepIndex) {
		case 1:
			// setStatus("Step 1: Initialize your username.");
			break;
		case 2:
			// setStatus("Step 2: Connect with peers.");
			startConnection();
			break;
		default:
			setStatus("Unknown step.");
			console.error("Unknown step.");
	}
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
		callButton.addEventListener("click", () => {
			setStatus(`Calling user: ${username}`);
			// Send an answer to the signaling server for this user.
			sendAnswerToServer(username);
		});

		item.append(name, callButton);
		list.appendChild(item);
	});

	activeUsersList.appendChild(list);
}

function ensureManagers() {
	if (!state.userManager) {
		state.userManager = new UserManager({
			onStatus: setStatus,
			onUserChange: handleNameChange,
		});
	}

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
			getAnswerToken: (offer) => {
				offerInput.value = offer;
				return processIncomingToken();
			},
			onAnswer: async (answer) => {
				answerInput.value = answer;
				completeOfferWithAnswer();
			},
			onRestart: () => {
				setStatus("Signaling server requested a restart.");
				restart();
			},
		});
	}

	if (!state.fastConnectionManager) {
		state.fastConnectionManager = new FastConnectionManager({
			onStatus: setStatus,
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
	if (await state.webrtc.completeOfferWithAnswer(rawText)) {
		setStatus("Offer completed successfully.");

		//stop polling for active users after the offer is completed successfully.
		state.signal.stopPolling();
	}
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

async function handleNameChange(newName) {
	ensureManagers();
	if (!newName) {
		setStatus("Username is required to proceed.");
		return;
	}

	const userName = newName;

	state.userManager.setUsername(userName);
	state.signal.setUsername(userName);
	// setStatus(`Username updated to: ${userName}`);
	userNameDisplay.textContent = `Username: ${userName}`;

	setStepVisibility(2);
}

async function restart() {
	ensureManagers();

	// tell server to log out the current user
	await state.signal.logOut();

	// reload the page
	location.reload();
}

async function sendAnswerToServer(targetUser) {
	ensureManagers();
	await state.signal.requestOffer(targetUser);
}

function getCurrentUserName() {
	ensureManagers();
	const username = state.userManager.getUsername();
	if (!username) {
		setStatus("Save a username before sharing a fast connection link.");
		return null;
	}
	return username;
}

function shareFastConnectionVia(methodName) {
	const username = getCurrentUserName();
	if (!username) {
		return;
	}

	if (!state.fastConnectionManager) {
		state.fastConnectionManager = new FastConnectionManager({
			onStatus: setStatus,
		});
	}

	state.fastConnectionManager[methodName](username);
	setStatus(
		`Opening ${methodName === "sendFastUrlWithText" ? "text" : "email"} share flow for ${username}.`,
	);
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

userNameForm.addEventListener("submit", async (event) => {
	event.preventDefault();
	await handleNameChange(userNameInput.value.trim());
});

clearUserNameBtn.addEventListener("click", async () => {
	state.userManager.clearUsername();
	setStepVisibility(1);
	await restart();
});

shareFastTextBtn.addEventListener("click", () => {
	shareFastConnectionVia("sendFastUrlWithText");
});

shareFastEmailBtn.addEventListener("click", () => {
	shareFastConnectionVia("sendFastUrlWithEmail");
});

//#endregion

setStatus(
	"Ready to start a call. Generate an offer, copy it, transfer it manually, then complete the call with the answer token.",
);

async function startConnection() {
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

	// // prompt user for username
	// const userName = prompt("Enter your username:");
	// if (!userName) {
	// 	setStatus("Username is required to proceed.");
	// 	return;
	// }
	// currentUserName.value = userName;

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

// make sure all managers are initialized before proceeding.
ensureManagers();

//check if this is a fast connection
if (
	state.fastConnectionManager &&
	state.fastConnectionManager.isFastConnection()
) {
	const fastTarget = state.fastConnectionManager.getFastTarget();
	if (fastTarget) {
		setStatus(`Fast connection target detected: ${fastTarget}`);
		// You can now use fastTarget to initiate a fast connection
		state.signal.requestOffer(fastTarget);
	}
} else {
	//call get username on load
	if (state.userManager) {
		const savedUserName = state.userManager.getUsername();
		if (savedUserName) {
			userNameInput.value = savedUserName;
			userNameDisplay.textContent = `Username: ${savedUserName}`;
			state.signal.setUsername(savedUserName);

			setStepVisibility(2);
		} else {
			setStepVisibility(1);
		}
	}
}
