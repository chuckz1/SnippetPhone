# Current server url

const url = "https://script.google.com/macros/s/AKfycbzrDW6pei-ZNnki1AdPZBVxg3WbckDUhAphOHN2NbNgpUSHlvCkAwg7c53YXDreVesQhg/exec";

# Recommended approach

Use simple GET requests only. The server stores offer/answer/candidate state and the client polls it instead of using WebSocket or POST requests. This avoids CORS issues because all communication is just fetch() calls to the same endpoint.

# Server code

```javascript
const props = PropertiesService.getScriptProperties();

function clearProps() {
	props.deleteProperty("offer");
	props.deleteProperty("offerOwnerId");
	props.deleteProperty("answer");
	props.deleteProperty("answerOwnerId");
	props.deleteProperty("candidatesA");
	props.deleteProperty("candidatesB");
}

function doGet(e) {
	const action = e.parameter.action;
	const userId = e.parameter.id || "";

	switch (action) {
		case "offer":
			return maybeClearSelfOffer(userId, "offer", () =>
				respondJSON({ offer: null, ownerId: null }),
			);

		case "answer":
			return maybeClearSelfAnswer(userId, "answer", () =>
				respondJSON({ answer: null, ownerId: null }),
			);

		case "candidatesA":
			return respondJSON({
				candidates: JSON.parse(props.getProperty("candidatesA") || "[]"),
			});

		case "candidatesB":
			return respondJSON({
				candidates: JSON.parse(props.getProperty("candidatesB") || "[]"),
			});

		case "setOffer":
			props.setProperty("offerOwnerId", userId);
			props.setProperty("offer", e.parameter.sdp);
			return respond("OK: offer stored");

		case "setAnswer":
			props.setProperty("answerOwnerId", userId);
			props.setProperty("answer", e.parameter.sdp);
			return respond("OK: answer stored");

		case "addCandidateA":
			const a = JSON.parse(props.getProperty("candidatesA") || "[]");
			a.push({
				id: userId,
				candidate: e.parameter.candidate,
			});
			props.setProperty("candidatesA", JSON.stringify(a));
			return respond("OK: candidateA stored");

		case "addCandidateB":
			const b = JSON.parse(props.getProperty("candidatesB") || "[]");
			b.push({
				id: userId,
				candidate: e.parameter.candidate,
			});
			props.setProperty("candidatesB", JSON.stringify(b));
			return respond("OK: candidateB stored");

		case "clearAll":
			clearProps();
			return respond("OK: signaling state cleared");

		default:
			return respond("ERROR: unknown action");
	}
}

function maybeClearSelfOffer(userId, key, emptyResponse) {
	const storedOffer = props.getProperty("offer");
	const storedOwnerId = props.getProperty("offerOwnerId");

	if (!storedOffer) {
		return respondJSON({ offer: null, ownerId: null });
	}

	if (storedOwnerId && storedOwnerId === userId) {
		props.deleteProperty("offer");
		props.deleteProperty("offerOwnerId");
		return emptyResponse();
	}

	return respondJSON({ offer: storedOffer, ownerId: storedOwnerId });
}

function maybeClearSelfAnswer(userId, key, emptyResponse) {
	const storedAnswer = props.getProperty("answer");
	const storedOwnerId = props.getProperty("answerOwnerId");

	if (!storedAnswer) {
		return respondJSON({ answer: null, ownerId: null });
	}

	if (storedOwnerId && storedOwnerId === userId) {
		props.deleteProperty("answer");
		props.deleteProperty("answerOwnerId");
		return emptyResponse();
	}

	return respondJSON({ answer: storedAnswer, ownerId: storedOwnerId });
}

function respond(text) {
	return ContentService.createTextOutput(text);
}

function respondJSON(obj) {
	return ContentService.createTextOutput(JSON.stringify(obj));
}
```

## Temp ID flow

Each client should generate a large random identifier before signaling starts. A UUID is ideal, but any sufficiently large random string is fine:

```javascript
const tempId = crypto.randomUUID();
```

Every request includes that id in the query string:

```javascript
await fetch(
	`${url}?action=setOffer&id=${encodeURIComponent(tempId)}&sdp=${encodeURIComponent(sdp)}`,
);
const res = await fetch(`${url}?action=offer&id=${encodeURIComponent(tempId)}`);
```

When the server receives a `get offer` or `get answer` request, it compares the requesting `id` against the stored `offerOwnerId` or `answerOwnerId`. If they match, it deletes the stored value and returns an empty response so the peer does not see its own offer/answer.

This keeps each side from reacting to its own outbound SDP while still allowing the other side to fetch it normally.

## Reset endpoint

Use the clear-all endpoint only after the WebRTC connection is complete and you want to free the signaling slot for the next call. This should not be used during negotiation because it would wipe the active offer/answer state mid-handshake.

```javascript
await fetch(`${url}?action=clearAll&id=${encodeURIComponent(tempId)}`);
```

Typical usage:

```javascript
// after the data channel and peer connection are both established
await fetch(`${url}?action=clearAll&id=${encodeURIComponent(tempId)}`);
```

This makes it easy to reset the server state between sessions without leaving old SDP or candidate data behind for a future connection.

- no CORS preflight issues for a simple public endpoint
- easier to debug because every action is visible in the URL
- simpler server code
- easier to reason about because polling is explicit and predictable
