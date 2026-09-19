const state = {
	peer: null,
	localStream: null,
	offerIceCandidates: [],
	answerIceCandidates: [],
	generatedOfferToken: "",
	generatedAnswerToken: "",
	localAudioMuted: false,
};

const config = {
	iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
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

/**
 * Adds a status message to the visible log panel.
 * @param {string} message - Human-readable connection update.
 */
function setStatus(message) {
	statusLog.textContent = `${new Date().toLocaleTimeString()} - ${message}`;
}

/**
 * Creates a peer connection and attaches the local microphone track.
 * @returns {RTCPeerConnection} The configured peer connection instance.
 */
function createPeerConnection() {
	if (state.peer) {
		return state.peer;
	}

	const peer = new RTCPeerConnection(config);
	state.peer = peer;

	peer.ontrack = (event) => {
		const [remoteStream] = event.streams;
		if (remoteStream) {
			remoteAudio.srcObject = remoteStream;
			setStatus("Remote audio stream connected.");
		}
	};

	peer.onconnectionstatechange = () => {
		const { connectionState } = peer;
		if (connectionState === "connected") {
			setStatus("WebRTC connection established. Voice is live.");
		}
		if (connectionState === "failed") {
			setStatus("Connection failed. Try generating a fresh token pair.");
		}
		if (connectionState === "disconnected") {
			setStatus("Connection disconnected.");
		}
	};

	peer.onicecandidate = (event) => {
		if (!event.candidate) {
			return;
		}

		const candidate = {
			candidate: event.candidate.candidate,
			sdpMid: event.candidate.sdpMid,
			sdpMLineIndex: event.candidate.sdpMLineIndex,
			usernameFragment: event.candidate.usernameFragment,
		};

		if (peer.localDescription && peer.localDescription.type === "offer") {
			state.offerIceCandidates.push(candidate);
		} else if (
			peer.localDescription &&
			peer.localDescription.type === "answer"
		) {
			state.answerIceCandidates.push(candidate);
		}
	};

	if (state.localStream) {
		state.localStream
			.getTracks()
			.forEach((track) => peer.addTrack(track, state.localStream));
	}

	return peer;
}

/**
 * Waits until the ICE gathering phase is complete for the active peer connection.
 * @returns {Promise<void>} Resolves when ICE collection finishes.
 */
function waitForIceGathering() {
	return new Promise((resolve) => {
		const peer = state.peer;
		if (!peer) {
			resolve();
			return;
		}

		if (peer.iceGatheringState === "complete") {
			resolve();
			return;
		}

		const onStateChange = () => {
			if (peer.iceGatheringState === "complete") {
				peer.removeEventListener("icegatheringstatechange", onStateChange);
				resolve();
			}
		};

		peer.addEventListener("icegatheringstatechange", onStateChange);
	});
}

/**
 * Adds ICE candidates received from the remote client to the live connection.
 * @param {Array<Object>} candidates - Candidate objects from the other side.
 * @returns {Promise<void>} Resolves after all candidates are added.
 */
async function applyCandidates(candidates = []) {
	const peer = state.peer;
	if (!peer || !candidates.length) {
		return;
	}

	for (const candidate of candidates) {
		try {
			await peer.addIceCandidate(new RTCIceCandidate(candidate));
		} catch (error) {
			console.warn("Failed to add ICE candidate:", error);
		}
	}
}

/**
 * Ensures the browser microphone is active before beginning a call.
 * @returns {Promise<void>} Resolves once the microphone stream is ready.
 */
async function startMicrophone() {
	if (state.localStream) {
		setStatus("Microphone is already active.");
		return;
	}

	try {
		const stream = await navigator.mediaDevices.getUserMedia({
			audio: true,
			video: false,
		});

		state.localStream = stream;
		if (state.peer) {
			stream.getTracks().forEach((track) => state.peer.addTrack(track, stream));
		}
		setStatus("Microphone access granted.");
	} catch (error) {
		console.error(error);
		setStatus(
			"Microphone access was blocked. Allow microphone access and try again.",
		);
	}
}

/**
 * Generates an offer token for the first client in the call.
 * @returns {Promise<string>} The JSON offer token ready to pass to the other user.
 */
async function generateOfferToken() {
	await startMicrophone();

	const peer = createPeerConnection();
	const offer = await peer.createOffer();
	await peer.setLocalDescription(offer);
	await waitForIceGathering();

	const token = {
		version: 1,
		type: "offer",
		sdp: peer.localDescription.sdp,
		candidates: state.offerIceCandidates.slice(),
	};

	state.generatedOfferToken = JSON.stringify(token, null, 2);
	offerInput.value = "";
	setStatus("Offer token generated. Copy it and send it to the second client.");
	return state.generatedOfferToken;
}

/**
 * Parses a remote token and handles both offer and answer payloads.
 * @returns {Promise<string | null>} The answer token if an offer is received.
 */
async function processIncomingToken() {
	const rawText = offerInput.value.trim();

	if (!rawText) {
		setStatus("Paste a valid token before connecting.");
		return null;
	}

	let token;

	try {
		token = JSON.parse(rawText);
	} catch (error) {
		setStatus("The pasted token is not valid JSON.");
		console.error(error);
		return null;
	}

	if (!token || !token.type || !token.sdp) {
		setStatus("The token is missing the required WebRTC information.");
		return null;
	}

	await startMicrophone();

	if (token.type === "offer") {
		const peer = createPeerConnection();
		state.answerIceCandidates = [];
		await peer.setRemoteDescription(
			new RTCSessionDescription({ type: "offer", sdp: token.sdp }),
		);
		await applyCandidates(token.candidates || []);

		const answer = await peer.createAnswer();
		await peer.setLocalDescription(answer);
		await waitForIceGathering();

		const answerToken = {
			version: 1,
			type: "answer",
			sdp: peer.localDescription.sdp,
			candidates: state.answerIceCandidates.slice(),
		};

		state.generatedAnswerToken = JSON.stringify(answerToken, null, 2);
		answerInput.value = "";
		setStatus("Answer token created. Copy it and send it back to the caller.");
		return state.generatedAnswerToken;
	}

	if (token.type === "answer") {
		if (!state.peer) {
			setStatus("No active offer exists yet. Generate an offer token first.");
			return null;
		}

		await state.peer.setRemoteDescription(
			new RTCSessionDescription({ type: "answer", sdp: token.sdp }),
		);
		await applyCandidates(token.candidates || []);
		setStatus("Answer received. Call is connected.");
		return null;
	}

	setStatus("Unknown token type. Expected offer or answer.");
	return null;
}

/**
 * Completes a peer connection using the answer token generated by the receiving client.
 * @returns {Promise<void>} Resolves after the remote answer is applied.
 */
async function completeOfferWithAnswer() {
	const rawText = answerInput.value.trim();
	if (!rawText) {
		setStatus("Paste the answer token before completing the call.");
		return;
	}

	let token;
	try {
		token = JSON.parse(rawText);
	} catch (error) {
		setStatus("The pasted answer token is not valid JSON.");
		console.error(error);
		return;
	}

	if (!token || !token.type || token.type !== "answer" || !token.sdp) {
		setStatus("The pasted answer token looks invalid.");
		return;
	}

	if (!state.peer) {
		setStatus("There is no active offer to complete. Generate an offer first.");
		return;
	}

	await state.peer.setRemoteDescription(
		new RTCSessionDescription({ type: "answer", sdp: token.sdp }),
	);
	await applyCandidates(token.candidates || []);
	setStatus("Answer applied. The call is now connected.");
}

/**
 * Copies the provided text to the clipboard.
 * @param {string} value - String to copy.
 */
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
	if (!state.generatedOfferToken) {
		setStatus("Generate an offer token first.");
		return;
	}

	await copyToClipboard(state.generatedOfferToken);
}

async function copyGeneratedAnswer() {
	if (!state.generatedAnswerToken) {
		setStatus("Generate an answer token first.");
		return;
	}

	await copyToClipboard(state.generatedAnswerToken);
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
	"Ready to start a call. Create an offer token on one client and paste it on the second client.",
);
