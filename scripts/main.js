import { WebRTCManager } from "./webrtc.js";
import { VADManager } from "./vad.js";
import { SignalingManager } from "./signaling.js";
import { UserManager } from "./userManager.js";
import { FastConnectionManager } from "./fastConnection.js";
import { CompressionManager } from "./compression.js";

const state = {
	webrtc: null,
	vad: null,
	signal: null,
	userManager: null,
	fastConnectionManager: null,
	compressionManager: null,
};

//not used
const startMicBtn = document.getElementById("startMicBtn");
const createOfferBtn = document.getElementById("createOfferBtn");
const copyOfferBtn = document.getElementById("copyOfferBtn");
const connectBtn = document.getElementById("connectBtn");
const copyAnswerBtn = document.getElementById("copyAnswerBtn");
const completeCallBtn = document.getElementById("completeCallBtn");
const offerInput = document.getElementById("offerInput");
const answerInput = document.getElementById("answerInput");
const remoteAudio = document.getElementById("remoteAudio");

// DOM elements for user interaction and status display.
const statusLog = document.getElementById("statusLog");
const webrtcStateText = document.getElementById("webrtcStateText");
const activeUsersList = document.getElementById("activeUsersList");
const userNameForm = document.getElementById("userNameForm");
const userNameInput = document.getElementById("currentUserName");
const userNameDisplay = document.getElementById("currentUserNameDisplay");
const clearUserNameBtn = document.getElementById("clearUserNameBtn");
const shareFastTextBtn = document.getElementById("shareFastTextBtn");
const shareFastEmailBtn = document.getElementById("shareFastEmailBtn");
const startIntroBtn = document.getElementById("startIntroBtn");
const muteBtn = document.getElementById("muteBtn");
const speakerBtn = document.getElementById("speakerBtn");
const endCallBtn = document.getElementById("endCallBtn");

const step0 = document.getElementById("Step0");
const step1 = document.getElementById("Step1");
const step2 = document.getElementById("Step2");
const step2_5 = document.getElementById("Step2.5");
const step3 = document.getElementById("Step3");
const step4 = document.getElementById("Step4");

function setStatus(message) {
	statusLog.textContent = `${new Date().toLocaleTimeString()} - ${message}`;
}

function updateWebrtcState(stateName, message) {
	if (!webrtcStateText) {
		return;
	}

	const stateMap = {
		waiting: { emoji: "⏳", label: "Waiting for the other user" },
		offer: { emoji: "📤", label: "Offering a call" },
		answering: { emoji: "📥", label: "Answering the call" },
		connected: { emoji: "✅", label: "Connected" },
		hangup: { emoji: "📞", label: "Ending the call" },
	};

	const selectedState = stateMap[stateName] || stateMap.waiting;
	const emoji = document.querySelector(".state-emoji");
	if (emoji) {
		emoji.textContent = selectedState.emoji;
	}
	webrtcStateText.textContent = message || selectedState.label;
}

function setStepVisibility(stepIndex) {
	step0.hidden = stepIndex !== 0;
	step1.hidden = stepIndex !== 1;
	step2.hidden = stepIndex !== 2;
	step2_5.hidden = stepIndex !== 2.5;
	step3.hidden = stepIndex !== 3;
	step4.hidden = stepIndex !== 4;

	//this switch if for activities that should happen whenever switching to a new step
	switch (stepIndex) {
		case 0:
			// setStatus("Step 0: Introduction.");
			checkForMicPermission().then((hasPermission) => {
				if (hasPermission) {
					setStepVisibility(1); // Move to step 1 if microphone permission is granted
				}
			});
			break;
		case 1:
			//call get username on load
			if (state.userManager && state.fastConnectionManager) {
				const savedUserName = state.userManager.getUsername();
				if (state.fastConnectionManager.isFastConnection()) {
					userNameDisplay.textContent = `Username: Temp User`;
					setStatus("Fast connection detected, but no username is set.");
					setStepVisibility(2.5);
				} else if (savedUserName) {
					userNameInput.value = savedUserName;
					userNameDisplay.textContent = `Username: ${savedUserName}`;
					state.signal.setUsername(savedUserName);

					setStepVisibility(2);
				} else {
					setStepVisibility(1);
				}
			} else {
				setStatus("User manager or fast connection manager is not available.");
			}

			break;
		case 2.5:
		// setStatus("Step 2.5: Fast connection wait.");
		// overflow to case 2
		case 2:
			// setStatus("Step 2: Connect with peers.");
			resetAllManagers();
			startConnection();
			break;
		case 3:
			// setStatus("Step 3: In-call experience.");
			break;
		case 4:
			// setStatus("Step 4: Fast finished.");
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

	if (!state.compressionManager) {
		state.compressionManager = new CompressionManager({
			onStatus: setStatus,
		});
	}

	if (!state.webrtc) {
		state.webrtc = new WebRTCManager({
			onStatus: setStatus,
			onRemoteSnippet: () => {
				// Remote snippets are played through the WebRTC data channel callback and
				// do not require a separate audio element in the DOM.
			},
			onCallStarted: () => {
				setStatus("Call started successfully.");

				// log out the user from the signaling server.
				// this also stops polling for active users.
				state.signal.logOut();

				// //stop polling for active users after the offer is completed successfully.
				// state.signal.stopPolling();

				// Unmute the VAD manager when the call starts.
				if (state.vad) {
					state.vad.setMuted(false);
				}

				//display step 3
				setStepVisibility(3);
			},
			onCallEnded: (gracefully) => {
				setStatus(`Call ended ${gracefully ? "gracefully" : "unexpectedly"}.`);

				// Check if the call ended gracefully,
				if (gracefully) {
					//check if this was fast connection or a regular call
					if (state.fastConnectionManager.isFastConnection()) {
						// Show the fast finished panel
						setStepVisibility(4);
					} else {
						updateWebrtcState("hangup");

						// Reset to step 1 after a graceful call end.
						setStepVisibility(1);
					}
				} else {
					//TODO: handle unexpected call termination.
					console.error("Unexpected call termination.");
				}
			},
			decompressAudio: (data) => state.compressionManager.decompress(data),
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

				console.log("Compressing audio snippet before sending.");

				// Compress the audio buffer before sending it over the WebRTC data channel.
				const packets = await state.compressionManager.compress(int16Array);

				console.log("sending compressed audio snippet.");

				//log total packet count
				console.log("Total number of packets to be sent:", packets.length);

				const message = {
					type: "opus-batch",
					packets: packets.map((p) => p.buffer),
				};

				// console log total size of the message as bytes
				console.log(
					"Total size of the message to be sent:",
					message.packets.reduce((acc, buf) => acc + buf.byteLength, 0),
				);

				// group all the packets together before sending
				const sent = await state.webrtc.sendSnippet(JSON.stringify(message));
				// for (let i = 0; i < packets.length; i += 1) {
				// 	const sent = await state.webrtc.sendSnippet(packets[i]);
				// 	console.log(`Compressed audio snippet ${i + 1} sent:`, sent);
				// }

				console.log("Compressed audio snippet sent:", sent);

				// const sent = await state.webrtc.sendSnippet(compressedBuffer);
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
	updateWebrtcState("offer");
	await state.vad.startMic();
	state.webrtc.createPeerConnection();
	const token = await state.webrtc.generateOfferToken();
	offerInput.value = "";
	setStatus("Offer token generated. Copy it and send it to the second client.");
	return token;
}

async function processIncomingToken() {
	ensureManagers();
	updateWebrtcState("answering");
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
	updateWebrtcState("connected");
	const rawText = answerInput.value.trim();
	if (await state.webrtc.completeOfferWithAnswer(rawText)) {
		setStatus("Offer completed successfully.");
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

async function resetAllManagers() {
	ensureManagers();
	if (state.userManager) {
		state.userManager.resetManager();
	}
	if (state.vad) {
		state.vad.resetManager();
	}
	if (state.webrtc) {
		state.webrtc.resetManager();
	}
	if (state.fastConnectionManager) {
		state.fastConnectionManager.resetManager();
	}
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

function toggleVad() {
	ensureManagers();
	let muted = state.vad.toggleMuted();

	//set ui
	muteBtn.textContent = muted ? "🔇 Mic Muted" : "🔊 Mic On";
}

function toggleSpeaker() {
	ensureManagers();
	let muted = state.webrtc.toggleMuted();

	//set ui
	speakerBtn.textContent = muted ? "🔇 Speaker off" : "🔊 Speaker on";
}

function endCall() {
	ensureManagers();
	updateWebrtcState("hangup");
	console.log("Hanging up the call.");
	state.webrtc.hangUpCall();
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

startIntroBtn.addEventListener("click", async () => {
	await requestMicPermission();
	setStepVisibility(1);
});

muteBtn.addEventListener("click", async () => {
	await toggleVad();
});

speakerBtn.addEventListener("click", async () => {
	await toggleSpeaker();
});

endCallBtn.addEventListener("click", async () => {
	console.log("Ending the call.");
	await endCall();
});

//#endregion

//#region Bulk functions

async function startConnection() {
	if (!window.vad) {
		setStatus(
			"VAD library is still loading. Please wait a moment and try again.",
		);
		return;
	}

	// make sure all managers are initialized before proceeding.
	ensureManagers();

	// Initialize the compression manager if it exists.
	try {
		await state.compressionManager.initialize();
		setStatus("Compression manager initialized successfully.");
	} catch (error) {
		console.error("Failed to initialize compression manager:", error);
	}

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

	//check if this is a fast connection
	if (
		state.fastConnectionManager &&
		state.fastConnectionManager.isFastConnection()
	) {
		// skip init of signaling manager for fast connections
		const fastTarget = state.fastConnectionManager.getFastTarget();
		if (fastTarget) {
			setStatus(`Fast connection target detected: ${fastTarget}`);
			// You can now use fastTarget to initiate a fast connection
			state.signal.requestOffer(fastTarget);
		} else {
			setStatus("Fast connection detected, but no fast target is available.");
		}
	} else {
		// Initialize the signaling manager normal way
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
}

async function checkForMicPermission() {
	try {
		// Check the current status of the microphone permission
		const permissionStatus = await navigator.permissions.query({
			name: "microphone",
		});

		// Return true only if it has already been explicitly granted
		return permissionStatus.state === "granted";
	} catch (error) {
		console.error("Permissions API not supported or error occurred:", error);
		return false;
	}
}

async function requestMicPermission() {
	try {
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		// If we get here, the user granted permission
		stream.getTracks().forEach((track) => track.stop()); // Stop the tracks immediately
		return true;
	} catch (error) {
		console.error("Microphone permission denied or error occurred:", error);
		return false;
	}
}

//#endregion

// make sure all managers are initialized before proceeding.
ensureManagers();

setStepVisibility(0);
updateWebrtcState("waiting");
setStatus(
	"Ready to start a call. Generate an offer, copy it, transfer it manually, then complete the call with the answer token.",
);
