# Current server url

const url = "https://script.google.com/macros/s/AKfycbzrDW6pei-ZNnki1AdPZBVxg3WbckDUhAphOHN2NbNgpUSHlvCkAwg7c53YXDreVesQhg/exec";

# Three-endpoint signaling flow

Use simple GET requests only. The server owns a single state machine variable called `clientstate` and a current payload value. There are only three public actions: `get`, `set`, and `clear`.

This is intentionally simpler than separate offer/answer stores. The client will poll the server and interpret the returned state/data pair. We are keeping client updates for later; the server protocol is what matters here.

## State machine

- `0` = no clients active / default state
- `1` = first client has discovered a peer and is creating an offer
- `2` = offer was created and is waiting for the answer
- `3` = answer was created and is now waiting for the connection to complete

## Server behavior

### State `0`

- `set` does nothing
- `clear` does nothing
- `get` moves the server to state `1` and returns:

```json
{ "state": 1, "data": "create offer" }
```

This is the first call that discovers the handshake and tells the original caller to create an offer.

### State `1`

- `get` returns:

```json
{ "state": 1, "data": "wait" }
```

- The first client creates an offer and sends it through `set`.
- `set` with the offer transitions the server to state `2` and returns:

```json
{ "state": 2, "data": "accepted" }
```

The sent offer payload is stored as the server data value and will be returned by later `get` requests until the answer is set.

Any other `get` requests while state is `1` should keep returning `"wait"` until the offer is posted.

### State `2`

- `get` returns the current offer payload, with the state still set to `2`:

```json
{ "state": 2, "data": "<offer payload>" }
```

- The offering client waits for the second client to receive the offer, create an answer, and send it through `set`.
- `set` with the answer transitions the server to state `3` and returns:

```json
{ "state": 3, "data": "accepted" }
```

The sent answer payload is stored as the server data value and will be returned by later `get` requests until the connection is cleared.

### State `3`

- The second client waits while the first client polls for the answer.
- `get` returns:

```json
{ "state": 3, "data": "<answer payload>" }
```

- `set` does nothing in this state.

- Once the connection is established, the first client calls `clear` to reset the signal server.
- `clear` resets the server back to state `0` and clears the payload.
- Any `get` requests after this will start the handshake process anew.

## Apps Script server code

```javascript
const props = PropertiesService.getScriptProperties();
const STATE_KEY = "clientstate";
const DATA_KEY = "data";

function getState() {
	const value = Number(props.getProperty(STATE_KEY) || 0);
	return Number.isFinite(value) ? value : 0;
}

function getPayload() {
	return props.getProperty(DATA_KEY) || null;
}

function setState(state, payload) {
	props.setProperty(STATE_KEY, String(state));
	if (payload === null) {
		props.deleteProperty(DATA_KEY);
		return;
	}
	props.setProperty(DATA_KEY, String(payload));
}

function clearState() {
	props.deleteProperty(STATE_KEY);
	props.deleteProperty(DATA_KEY);
	props.setProperty(STATE_KEY, "0");
}

function doGet(e) {
	const action = (e.parameter.action || "").toLowerCase();

	switch (action) {
		case "get":
			return respondJSON(handleGet());
		case "set":
			return respondJSON(handleSet(e.parameter.data || ""));
		case "clear":
			return respondJSON(handleClear());
		default:
			return respondJSON({ state: getState(), data: "unknown action" });
	}
}

function handleGet() {
	const currentState = getState();

	if (currentState === 0) {
		setState(1, "create offer");
		return { state: 1, data: "create offer" };
	}

	if (currentState === 1) {
		return { state: 1, data: "wait" };
	}

	return { state: currentState, data: getPayload() };
}

function handleSet(payload) {
	const currentState = getState();

	if (currentState === 0) {
		return { state: 0, data: "no-op" };
	}

	if (currentState === 1) {
		setState(2, payload);
		return { state: 2, data: "accepted" };
	}

	if (currentState === 2) {
		setState(3, payload);
		return { state: 3, data: "accepted" };
	}

	if (currentState === 3) {
		return { state: 3, data: "accepted" };
	}

	return { state: currentState, data: getPayload() };
}

function handleClear() {
	const currentState = getState();

	if (currentState === 0) {
		return { state: 0, data: "no-op" };
	}

	clearState();
	return { state: 0, data: "cleared" };
}

function respondJSON(obj) {
	return ContentService.createTextOutput(JSON.stringify(obj));
}
```

## Request examples

### Start the handshake

```javascript
const response = await fetch(`${url}?action=get`);
const result = await response.json();
// { state: 1, data: "create offer" }
```

### Send the offer

```javascript
const response = await fetch(
	`${url}?action=set&data=${encodeURIComponent(offerSdp)}`,
);
const result = await response.json();
// { state: 2, data: "accepted" }
```

### Get the offer or answer

```javascript
const response = await fetch(`${url}?action=get`);
const result = await response.json();
// state 2 => offer is waiting
// state 3 => answer is waiting
```

### Send the answer

```javascript
const response = await fetch(
	`${url}?action=set&data=${encodeURIComponent(answerSdp)}`,
);
const result = await response.json();
// { state: 3, data: "accepted" }
```

### Clear the server after the connection is established

```javascript
const response = await fetch(`${url}?action=clear`);
const result = await response.json();
// { state: 0, data: "cleared" }
```

## Notes

- The server uses one authoritative `clientstate` variable to drive the handshake.
- The payload is the current SDP string that clients must read and write during the workflow.
- This deliberately avoids per-client IDs and separate offer/answer ownership variables.
- The `clear` endpoint is only used after the connection is live so the next handshake can start cleanly.
- This is a two-peer state machine. It is intentionally simple and meant to be easy to reason about before the client code is updated to match it.
