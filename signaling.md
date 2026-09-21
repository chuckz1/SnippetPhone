# Current server url

const url = "https://script.google.com/macros/s/AKfycbzrDW6pei-ZNnki1AdPZBVxg3WbckDUhAphOHN2NbNgpUSHlvCkAwg7c53YXDreVesQhg/exec";

# Role-based signaling flow

The server assigns a unique `userId` to each client when they first connect.

The server maintains a rolling `userId` counter that starts at `1` and increments upward until it reaches `100`. When the counter hits `100`, it rolls back to the original starting value of `1` instead of continuing higher. This prevents stale clients from holding an ID long enough to collide with a newer client using the same value.

This flow is based on role assignment, not on a shared state-value pair. The server tracks each client by its assigned `userId` and stores that client's role and signaling state.

## Core rules

- The first client to connect gets role `offerer`.
- The second client to connect gets role `answerer`.
- The server assigns incremental `userId` values starting at `1`.
- When the counter reaches `100`, the next user gets `userId = 1` again.
- If a third client tries to request a role, the server resets the role list first, then assigns that third client the first client role and restarts the session.
- Any call to another endpoint with an invalid `userId` must return `restart`.
- If the server responds with `restart`, the client must re-initiate the handshake from the beginning, including calling `get role()` again.
- The `get` endpoints are expected to be polled.

## Server-side tracking

The server stores the active session as a small set of variables, for example:

```json
{
	"userIdCounter": "3",
	"offererId": "1",
	"answererId": "2",
	"offerSdp": "...",
	"answerSdp": "...",
	"offerIceCandidates": ["..."],
	"answerIceCandidates": ["..."]
}
```

There will only ever be one offerer and one answerer in the active session, so the server does not need to keep a list of client records. It only needs the IDs for those two roles plus the current signaling payloads and the next ID to assign.

## Role assignment

### `get role()`

The client first calls `get role()` with no parameters.

- If there is no active session, the server assigns the next incremental `userId` value and returns:

```json
{ "userId": 1, "role": "offerer", "state": "waitingForOffer" }
```

- If the first client already exists and is in the offerer role, the second client is assigned the next incremental `userId` value and returns:

```json
{ "userId": 2, "role": "answerer", "state": "waitingForAnswer" }
```

- Once the counter reaches `100`, the next assigned ID resets to `1` and the cycle continues.

- If a third client attempts to get a role while the session is already full, the server first clears the stored role list, then assigns that third client the first client role and restarts the session.

## Handshake flow

### Offerer sends offer

```text
send offer (int userId, string offerSdp)
```

- The offerer sends their SDP to the server using their assigned `userId`.
- The server stores the offer and updates the state to reflect that the offer is waiting for the answer.
- Response:

```json
{ "status": "accepted" }
```

### Offerer sends offer ICE candidates

```text
send offer ICE (int userId, string iceCandidate)
```

- The server stores the ICE candidate for the offerer.
- Response:

```json
{ "status": "accepted" }
```

### Answerer gets the offer

```text
get offer (int userId)
```

- The answerer polls this endpoint with their assigned `userId`.
- The server returns the current offer SDP when available.

```json
{ "userId": 2, "offerSdp": "<offer payload>" }
```

### Answerer gets offer ICE candidates

```text
get offer ICE (int userId)
```

- The answerer polls for ICE candidates belonging to the offerer.
- The server returns the pending ICE candidates.
- If the `userId` is valid, the server clears the stored offer ICE candidate list after returning it so the same candidates are not sent repeatedly.

```json
{ "userId": 2, "iceCandidates": ["..."] }
```

### Answerer sends answer

```text
send answer (int userId, string answerSdp)
```

- The answerer sends the SDP answer using their assigned `userId`.
- The server stores the answer and marks the handshake as complete enough for the peer to begin connection setup.
- Response:

```json
{ "status": "accepted" }
```

### Answerer sends answer ICE candidates

```text
send answer ICE (int userId, string iceCandidate)
```

- The server stores the answerer's ICE candidates.
- Response:

```json
{ "status": "accepted" }
```

### Offerer gets the answer

```text
get answer (int userId)
```

- The offerer polls this endpoint using their assigned `userId`.
- The server returns the stored answer when available.

```json
{ "userId": 1, "answerSdp": "<answer payload>" }
```

### Offerer gets answer ICE candidates

```text
get answer ICE (int userId)
```

- The offerer polls for the answerer's ICE candidates.
- The server returns the pending ICE candidates.
- If the `userId` is valid, the server clears the stored answer ICE candidate list after returning it so the same candidates are not sent repeatedly.

```json
{ "userId": 1, "iceCandidates": ["..."] }
```

## Invalid userId behavior

Any endpoint other than `get role()` requires a valid `userId`.

- If a request uses an unknown or stale `userId`, the server returns:

```json
{ "status": "restart" }
```

- The client must then start the handshake again from the beginning by calling `get role()` with no parameters.

## Session reset

### `clear Server()`

This endpoint is used to clear the server state after the connection is established.

```text
clear Server()
```

When called, the server clears all assignments, roles, and stored signaling data and returns:

```json
{ "status": "cleared" }
```

After that, the next client to connect can begin a fresh handshake.

## Request examples

### Request a role before assignment

```javascript
const response = await fetch(`${url}?action=getRole`);
const result = await response.json();
// { userId: 1, role: "offerer", state: "waitingForOffer" }
```

### Send an offer

```javascript
const response = await fetch(
	`${url}?action=sendOffer&userId=1&data=${encodeURIComponent(offerSdp)}`,
);
const result = await response.json();
// { status: "accepted" }
```

### Get the offer

```javascript
const response = await fetch(`${url}?action=getOffer&userId=2`);
const result = await response.json();
// { userId: 2, offerSdp: "..." }
```

### Send the answer

```javascript
const response = await fetch(
	`${url}?action=sendAnswer&userId=2&data=${encodeURIComponent(answerSdp)}`,
);
const result = await response.json();
// { status: "accepted" }
```

### Get the answer

```javascript
const response = await fetch(`${url}?action=getAnswer&userId=1`);
const result = await response.json();
// { userId: 1, answerSdp: "..." }
```

### Reset after connection

```javascript
const response = await fetch(`${url}?action=clearServer`);
const result = await response.json();
// { status: "cleared" }
```

## Notes

- The server owns the authoritative client registry and assigns the `userId` values.
- `userId` values increment from `1` upward and roll back to `1` at `100` to avoid stale-client collisions.
- The first client is the offerer and the second client is the answerer.
- A third client forces a `restart` to maintain a two-peer session.
- Any invalid `userId` or restart signal means all clients must re-enter the role-assignment flow.
- The server tracks client role and state by `userId`, which keeps the signaling flow explicit and easy to reason about.
- When a valid client calls `get offer ICE` or `get answer ICE`, the server clears that candidate list after returning it so polling does not repeat the same ICE candidates.

# Server code

```javascript
// WebRTC signaling server for Apps Script (GET-only)

// ---- Storage helpers ----

function getState_() {
	const props = PropertiesService.getScriptProperties();
	const raw = props.getProperty("signalingState");
	if (!raw) {
		return {
			userIdCounter: 1,
			offererId: null,
			answererId: null,
			offerSdp: null,
			answerSdp: null,
			offerIceCandidates: [],
			answerIceCandidates: [],
		};
	}
	try {
		return JSON.parse(raw);
	} catch (e) {
		return {
			userIdCounter: 1,
			offererId: null,
			answererId: null,
			offerSdp: null,
			answerSdp: null,
			offerIceCandidates: [],
			answerIceCandidates: [],
		};
	}
}

function saveState_(state) {
	const props = PropertiesService.getScriptProperties();
	props.setProperty("signalingState", JSON.stringify(state));
}

function clearState_() {
	const props = PropertiesService.getScriptProperties();
	props.deleteProperty("signalingState");
}

// ---- Utility ----

function jsonResponse_(obj) {
	return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
		ContentService.MimeType.JSON,
	);
}

function parseIntSafe_(value) {
	const n = parseInt(value, 10);
	return Number.isNaN(n) ? null : n;
}

function isValidUser_(state, userId) {
	return (
		userId !== null &&
		(userId === state.offererId || userId === state.answererId)
	);
}

// ---- Main entry ----

function doGet(e) {
	const action = (e.parameter.action || "").trim();
	const state = getState_();

	switch (action) {
		case "getRole":
			return handleGetRole_(state);

		case "sendOffer":
			return handleSendOffer_(state, e);

		case "getOffer":
			return handleGetOffer_(state, e);

		case "sendOfferIce":
		case "sendOfferICE":
			return handleSendOfferIce_(state, e);

		case "getOfferIce":
		case "getOfferICE":
			return handleGetOfferIce_(state, e);

		case "sendAnswer":
			return handleSendAnswer_(state, e);

		case "getAnswer":
			return handleGetAnswer_(state, e);

		case "sendAnswerIce":
		case "sendAnswerICE":
			return handleSendAnswerIce_(state, e);

		case "getAnswerIce":
		case "getAnswerICE":
			return handleGetAnswerIce_(state, e);

		case "clearServer":
			return handleClearServer_();

		default:
			return jsonResponse_({ status: "unknownAction" });
	}
}

// ---- Handlers ----

function handleGetRole_(state) {
	// No active session yet: first client becomes offerer
	if (!state.offererId && !state.answererId) {
		const userId = state.userIdCounter;
		state.offererId = userId;
		state.userIdCounter = nextUserId_(state.userIdCounter);
		saveState_(state);
		return jsonResponse_({
			userId,
			role: "offerer",
			state: "waitingForOffer",
		});
	}

	// Offerer exists but no answerer yet: second client becomes answerer
	if (state.offererId && !state.answererId) {
		const userId = state.userIdCounter;
		state.answererId = userId;
		state.userIdCounter = nextUserId_(state.userIdCounter);
		saveState_(state);
		return jsonResponse_({
			userId,
			role: "answerer",
			state: "waitingForAnswer",
		});
	}

	// Session already full: clear and restart, third client becomes new offerer
	clearState_();
	const newState = getState_();
	const userId = newState.userIdCounter;
	newState.offererId = userId;
	newState.userIdCounter = nextUserId_(newState.userIdCounter);
	saveState_(newState);
	return jsonResponse_({
		userId,
		role: "offerer",
		state: "waitingForOffer",
	});
}

function nextUserId_(current) {
	const next = current + 1;
	return next > 100 ? 1 : next;
}

function handleSendOffer_(state, e) {
	const userId = parseIntSafe_(e.parameter.userId);
	if (!isValidUser_(state, userId) || userId !== state.offererId) {
		return jsonResponse_({ status: "restart" });
	}

	const offerSdp = e.parameter.data || "";
	state.offerSdp = offerSdp;
	saveState_(state);
	return jsonResponse_({ status: "accepted" });
}

function handleGetOffer_(state, e) {
	const userId = parseIntSafe_(e.parameter.userId);
	if (!isValidUser_(state, userId) || userId !== state.answererId) {
		return jsonResponse_({ status: "restart" });
	}

	if (!state.offerSdp) {
		return jsonResponse_({ userId, offerSdp: null });
	}

	return jsonResponse_({ userId, offerSdp: state.offerSdp });
}

function handleSendOfferIce_(state, e) {
	const userId = parseIntSafe_(e.parameter.userId);
	if (!isValidUser_(state, userId) || userId !== state.offererId) {
		return jsonResponse_({ status: "restart" });
	}

	const candidate = e.parameter.data || e.parameter.iceCandidate || "";
	if (!Array.isArray(state.offerIceCandidates)) {
		state.offerIceCandidates = [];
	}
	if (candidate) {
		state.offerIceCandidates.push(candidate);
	}
	saveState_(state);
	return jsonResponse_({ status: "accepted" });
}

function handleGetOfferIce_(state, e) {
	const userId = parseIntSafe_(e.parameter.userId);
	if (!isValidUser_(state, userId) || userId !== state.answererId) {
		return jsonResponse_({ status: "restart" });
	}

	const candidates = Array.isArray(state.offerIceCandidates)
		? state.offerIceCandidates.slice()
		: [];

	// Clear after returning so polling doesn’t repeat the same ICE candidates
	state.offerIceCandidates = [];
	saveState_(state);

	return jsonResponse_({ userId, iceCandidates: candidates });
}

function handleSendAnswer_(state, e) {
	const userId = parseIntSafe_(e.parameter.userId);
	if (!isValidUser_(state, userId) || userId !== state.answererId) {
		return jsonResponse_({ status: "restart" });
	}

	const answerSdp = e.parameter.data || "";
	state.answerSdp = answerSdp;
	saveState_(state);
	return jsonResponse_({ status: "accepted" });
}

function handleGetAnswer_(state, e) {
	const userId = parseIntSafe_(e.parameter.userId);
	if (!isValidUser_(state, userId) || userId !== state.offererId) {
		return jsonResponse_({ status: "restart" });
	}

	if (!state.answerSdp) {
		return jsonResponse_({ userId, answerSdp: null });
	}

	return jsonResponse_({ userId, answerSdp: state.answerSdp });
}

function handleSendAnswerIce_(state, e) {
	const userId = parseIntSafe_(e.parameter.userId);
	if (!isValidUser_(state, userId) || userId !== state.answererId) {
		return jsonResponse_({ status: "restart" });
	}

	const candidate = e.parameter.data || e.parameter.iceCandidate || "";
	if (!Array.isArray(state.answerIceCandidates)) {
		state.answerIceCandidates = [];
	}
	if (candidate) {
		state.answerIceCandidates.push(candidate);
	}
	saveState_(state);
	return jsonResponse_({ status: "accepted" });
}

function handleGetAnswerIce_(state, e) {
	const userId = parseIntSafe_(e.parameter.userId);
	if (!isValidUser_(state, userId) || userId !== state.offererId) {
		return jsonResponse_({ status: "restart" });
	}

	const candidates = Array.isArray(state.answerIceCandidates)
		? state.answerIceCandidates.slice()
		: [];

	// Clear after returning so polling doesn’t repeat the same ICE candidates
	state.answerIceCandidates = [];
	saveState_(state);

	return jsonResponse_({ userId, iceCandidates: candidates });
}

function handleClearServer_() {
	clearState_();
	return jsonResponse_({ status: "cleared" });
}
```
