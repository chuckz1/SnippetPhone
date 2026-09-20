# Current server url

const url = "https://script.google.com/macros/s/AKfycbzrDW6pei-ZNnki1AdPZBVxg3WbckDUhAphOHN2NbNgpUSHlvCkAwg7c53YXDreVesQhg/exec";

# Server code

```javascript
let store = {
	offer: null,
	answer: null,
	candidatesA: [],
	candidatesB: [],
};

function doPost(e) {
	const data = JSON.parse(e.postData.contents);

	switch (data.type) {
		case "offer":
			store.offer = data.sdp;
			return respond("OK: offer stored");

		case "answer":
			store.answer = data.sdp;
			return respond("OK: answer stored");

		case "candidateA":
			store.candidatesA.push(data.candidate);
			return respond("OK: candidateA stored");

		case "candidateB":
			store.candidatesB.push(data.candidate);
			return respond("OK: candidateB stored");

		default:
			return respond("ERROR: unknown type");
	}
}

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

# Client code example:

```javascript
async function startSymmetric() {
	// 1. Check if an offer exists
	let res = await fetch(url + "?action=offer");
	let json = await res.json();
	let offer = json.offer;

	if (!offer) {
		// I am the first device → create offer
		console.log("No offer found. I will create one.");

		const offerDesc = await pc.createOffer();
		await pc.setLocalDescription(offerDesc);

		await fetch(url, {
			method: "POST",
			body: JSON.stringify({ type: "offer", sdp: offerDesc }),
		});

		// Now wait for answer
		await waitForAnswer();
	} else {
		// Offer exists → I am the second device → create answer
		console.log("Offer found. I will create an answer.");

		await pc.setRemoteDescription(offer);

		const answerDesc = await pc.createAnswer();
		await pc.setLocalDescription(answerDesc);

		await fetch(url, {
			method: "POST",
			body: JSON.stringify({ type: "answer", sdp: answerDesc }),
		});
	}

	// Start ICE candidate polling
	pollCandidates();
}

async function waitForAnswer() {
	let answer = null;

	while (!answer) {
		await sleep(1000);

		let res = await fetch(url + "?action=answer");
		let json = await res.json();
		answer = json.answer;
	}

	console.log("Answer received.");
	await pc.setRemoteDescription(answer);
}

pc.onicecandidate = (e) => {
	if (e.candidate) {
		const type =
			pc.localDescription.type === "offer" ? "candidateA" : "candidateB";

		fetch(url, {
			method: "POST",
			body: JSON.stringify({ type, candidate: e.candidate }),
		});
	}
};

function pollCandidates() {
	setInterval(async () => {
		const type =
			pc.localDescription.type === "offer" ? "candidatesB" : "candidatesA";

		let res = await fetch(url + "?action=" + type);
		let json = await res.json();

		json.candidates.forEach((c) => pc.addIceCandidate(c));
	}, 1000);
}
```
