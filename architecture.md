# Current architecture

This project is a static browser-only WebRTC demo for a manual peer-to-peer voice call. It does not use a backend, signaling service, or server-side session management. The app runs entirely in the browser and relies on copy-pasting offer/answer tokens between two clients to complete the WebRTC handshake.

## Runtime model

The app is built as a single-page front-end using plain HTML, CSS, and JavaScript. There is no framework, build step, or package manager dependency.

- HTML provides the page structure and UI controls.
- CSS defines the dark single-page interface styling.
- JavaScript owns the WebRTC state machine, microphone access, token generation, and peer connection lifecycle.

## File responsibilities

### index.html

The entry page contains the complete user flow for the demo.

Sections in the page:

- Microphone permission button
- Offer generation and copy controls
- Manual offer/answer token fields
- Connection status log
- Remote audio element

The page uses a simple DOM structure and attaches all behavior from the script at the bottom of the file.

### styles.css

Defines the visual layer of the app:

- dark theme colors and panels
- button styling and layout utilities
- token field styling for textareas
- responsive layout behavior for smaller screens
- status log and audio player presentation

This is a small static stylesheet with no component architecture or CSS framework.

### scripts/main.js

This file contains the actual application logic. It keeps the state in a single object and drives the browser peer connection flow.

#### State object

The state tracks:

- active RTCPeerConnection
- local microphone stream
- ICE candidates collected for the offer and answer
- generated offer token JSON
- generated answer token JSON
- mute-related flags for local UI state

#### Configuration

The app creates an RTCPeerConnection using a Google STUN server:

- stun:stun.l.google.com:19302

This is the only network configuration used for ICE candidate discovery.

#### DOM bindings

The script reads the following elements from the page:

- startMicBtn
- createOfferBtn
- copyOfferBtn
- connectBtn
- copyAnswerBtn
- completeCallBtn
- offerInput
- answerInput
- statusLog
- remoteAudio

The script attaches click handlers to each control and updates the status log as the handshake progresses.

## Connection flow

### 1. Microphone access

The startMicrophone function requests access to the user's microphone through navigator.mediaDevices.getUserMedia({ audio: true, video: false }).

If the stream is granted:

- it stores the stream in state.localStream
- it adds the microphone track to the peer connection if one already exists

If access fails, the UI logs a user-facing error message.

### 2. Peer connection creation

The createPeerConnection function creates a single RTCPeerConnection whenever needed.

It also attaches:

- ontrack: receives the remote media stream and assigns it to the audio element
- onconnectionstatechange: updates the log when the connection is connected, disconnected, or failed
- onicecandidate: collects ICE candidates as they are gathered

### 3. ICE gathering and token creation

The waitForIceGathering helper waits until the peer connection completes ICE gathering.

The generateOfferToken function:

- ensures the local microphone is active
- creates an offer using peer.createOffer()
- sets the local description
- waits for ICE gathering to finish
- serializes the SDP and collected candidates into a JSON payload
- stores the result in state.generatedOfferToken
- empties the offer input field so the token is only copied manually

The resulting JSON is a WebRTC offer token that can be pasted into another browser tab or device.

### 4. Receiver side

The processIncomingToken function reads the pasted JSON from the offer field and parses it.

If the payload type is offer:

- it creates or reuses the RTCPeerConnection
- applies the remote offer via setRemoteDescription
- adds the received ICE candidates
- creates an answer via createAnswer()
- sets the local answer description
- waits for ICE gathering to finish
- packages the answer SDP and answer ICE candidates into a JSON object
- stores it in state.generatedAnswerToken
- clears the answer field so the token is copied manually

This is the exact manual signaling step used in the app: the second client generates an answer and hands it back to the first client.

### 5. Caller completion

The completeOfferWithAnswer function reads the pasted answer JSON from the answer field.

It:

- validates the token structure
- ensures an offer exists
- applies the remote answer using setRemoteDescription
- adds the received ICE candidates
- updates the status log to indicate the WebRTC session is connected

At this point, the audio track can flow between peers.

## Manual token exchange design

The app intentionally avoids a server-side signaling layer.

The actual manual handoff is:

1. Caller generates an offer token.
2. Caller copies the offer token.
3. Receiver pastes the offer token.
4. Receiver generates an answer token.
5. Receiver copies the answer token.
6. Caller pastes the answer token.
7. Caller completes the peer connection.

This design matches the browser-only static hosting requirement for GitHub Pages.

## Data flow summary

The architecture is a simple browser-to-browser exchange with no persistence or backend state.

- Local browser captures microphone audio.
- WebRTC peer connection gathers ICE candidates.
- Offer/answer JSON is passed manually between clients.
- Candidate and SDP data are rehydrated on each side.
- Remote audio stream is bound to the audio element.

## Current limitations

This is a minimal demo and not a production-ready signaling or network management system.

Currently, the project does not implement:

- server-based signaling
- user identity or room management
- automatic reconnect logic
- quality-based adaptive streaming
- VAD snippet extraction
- packet loss recovery or reorder handling
- text fallback mode

The code in this repository is focused only on the current static WebRTC handshake and manual token transfer flow.
