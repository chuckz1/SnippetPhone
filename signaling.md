# Current server url

const url = "https://script.google.com/macros/s/AKfycbzrDW6pei-ZNnki1AdPZBVxg3WbckDUhAphOHN2NbNgpUSHlvCkAwg7c53YXDreVesQhg/exec";

# Recommended approach

Use simple GET requests only. The server stores offer/answer/candidate state and the client polls it instead of using WebSocket or POST requests. This avoids CORS issues because all communication is just fetch() calls to the same endpoint.

# Server code

```javascript
let store = {
	offer: null,
	answer: null,
	candidatesA: [],
	candidatesB: [],
};

function doGet(e) {
	const action = e.parameter.action;

	switch (action) {
		case "offer":
			return respondJSON({ offer: store.offer });

		case "answer":
			return respondJSON({ answer: store.answer });

		case "candidatesA":
			return respondJSON({ candidates: store.candidatesA });

		case "candidatesB":
			return respondJSON({ candidates: store.candidatesB });

		case "setOffer":
			store.offer = e.parameter.sdp;
			return respond("OK: offer stored");

		case "setAnswer":
			store.answer = e.parameter.sdp;
			return respond("OK: answer stored");

		case "addCandidateA":
			store.candidatesA.push(e.parameter.candidate);
			return respond("OK: candidateA stored");

		case "addCandidateB":
			store.candidatesB.push(e.parameter.candidate);
			return respond("OK: candidateB stored");

		default:
			return respond("ERROR: unknown action");
	}
}

function respond(text) {
	return ContentService.createTextOutput(text);
}

function respondJSON(obj) {
	return ContentService.createTextOutput(JSON.stringify(obj));
}
```

# Client code example

```javascript
const url =
	"https://script.google.com/macros/s/AKfycbzrDW6pei-ZNnki1AdPZBVxg3WbckDUhAphOHN2NbNgpUSHlvCkAwg7c53YXDreVesQhg/exec";

async function setOffer(sdp) {
	await fetch(`${url}?action=setOffer&sdp=${encodeURIComponent(sdp)}`);
}

async function setAnswer(sdp) {
	await fetch(`${url}?action=setAnswer&sdp=${encodeURIComponent(sdp)}`);
}

async function addCandidate(type, candidate) {
	await fetch(
		`${url}?action=add${type}&candidate=${encodeURIComponent(candidate)}`,
	);
}

async function getOffer() {
	const res = await fetch(`${url}?action=offer`);
	return (await res.json()).offer;
}

async function getAnswer() {
	const res = await fetch(`${url}?action=answer`);
	return (await res.json()).answer;
}

async function getCandidates(type) {
	const res = await fetch(`${url}?action=candidates${type}`);
	return (await res.json()).candidates || [];
}

async function startSymmetric() {
	let offer = await getOffer();

	if (!offer) {
		console.log("No offer found. I will create one.");

		const offerDesc = await pc.createOffer();
		await pc.setLocalDescription(offerDesc);
		await setOffer(JSON.stringify(offerDesc));

		await waitForAnswer();
	} else {
		console.log("Offer found. I will create an answer.");
		await pc.setRemoteDescription(offer);

		const answerDesc = await pc.createAnswer();
		await pc.setLocalDescription(answerDesc);
		await setAnswer(JSON.stringify(answerDesc));
	}

	pollCandidates();
}

async function waitForAnswer() {
	let answer = null;

	while (!answer) {
		await sleep(1000);
		answer = await getAnswer();
	}

	console.log("Answer received.");
	await pc.setRemoteDescription(answer);
}

pc.onicecandidate = async (e) => {
	if (e.candidate) {
		const type = pc.localDescription.type === "offer" ? "A" : "B";
		await addCandidate(type, JSON.stringify(e.candidate));
	}
};

function pollCandidates() {
	setInterval(async () => {
		const type = pc.localDescription.type === "offer" ? "B" : "A";
		const candidates = await getCandidates(type);

		for (const raw of candidates) {
			await pc.addIceCandidate(JSON.parse(raw));
		}
	}, 1000);
}
```

# Why use GET-only signaling?

- no CORS preflight issues for a simple public endpoint
- easier to debug because every action is visible in the URL
- simpler server code
- easier to reason about because polling is explicit and predictable
