const DEFAULT_SIGNALING_URL =
	"https://script.google.com/macros/s/AKfycbzrDW6pei-ZNnki1AdPZBVxg3WbckDUhAphOHN2NbNgpUSHlvCkAwg7c53YXDreVesQhg/exec";

/**
 * Manages the GET-only signaling flow used by the Apps Script signaling endpoint.
 *
 * The browser stores SDP and ICE candidate values by hitting a URL with query parameters,
 * then polls the endpoint for the other peer's values. This avoids CORS issues because all
 * actions are simple GET requests to the same public endpoint.
 */
export class SignalManager {
	constructor({
		url = DEFAULT_SIGNALING_URL,
		onStatus = () => {},
		onOffer = () => {},
		onAnswer = () => {},
		onCandidate = () => {},
	} = {}) {
		this.serverUrl = url;
		this.onStatus = onStatus;
		this.onOffer = onOffer;
		this.onAnswer = onAnswer;
		this.onCandidate = onCandidate;
		this.tempId = this.createTempId();
		this.pollTimer = null;
		this.lastOfferSignature = "";
		this.lastAnswerSignature = "";
		this.seenCandidates = new Set();
		this.hasSentOffer = false;
		this.hasSentAnswer = false;
		this.signalingComplete = false;
		this.webrtcManager = null;
		this.pendingCandidates = [];
		this.pendingCandidateTimer = null;
		this.candidateFlushDelayMs = 1000;
	}

	createTempId() {
		if (
			globalThis.crypto &&
			typeof globalThis.crypto.randomUUID === "function"
		) {
			return globalThis.crypto.randomUUID();
		}
		return `temp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
	}

	buildSignalUrl(action, params = {}) {
		const query = new URLSearchParams({
			action,
			...params,
		});
		return `${this.serverUrl}?${query.toString()}`;
	}

	stopPolling() {
		this.signalingComplete = true;
		this.setStatus("Stopping signaling polling.");
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
	}

	setStatus(message) {
		this.onStatus(message);
		console.log(`[SignalManager] ${message}`);
	}

	startPolling() {
		if (this.pollTimer) {
			return;
		}

		this.pollSignalingState();
		this.pollTimer = setInterval(() => {
			this.pollSignalingState();
		}, 1000);
	}

	async fetchSignal(action, params = {}) {
		const url = this.buildSignalUrl(action, params);
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Signal fetch failed for ${action}: ${response.status}`);
		}

		const text = await response.text();
		if (!text) {
			return { state: 0, data: null };
		}

		try {
			const payload = JSON.parse(text);
			return {
				state: Number(payload.state ?? 0),
				data: payload.data ?? null,
			};
		} catch (error) {
			console.warn(`Non-JSON response for ${action}:`, text);
			return { state: 0, data: null };
		}
	}

	async getState() {
		return this.fetchSignal("get");
	}

	async setState(data) {
		return this.fetchSignal("set", { data });
	}

	async setOffer(sdp) {
		this.hasSentOffer = true;
		this.hasSentAnswer = false;
		this.signalingComplete = false;
		this.pendingCandidates = [];
		if (this.pendingCandidateTimer) {
			clearTimeout(this.pendingCandidateTimer);
			this.pendingCandidateTimer = null;
		}
		const result = await this.setState(sdp);
		console.log("[SignalManager] Sending offer to signaling server:", result);
		return result;
	}

	async setAnswer(sdp) {
		this.hasSentAnswer = true;
		this.signalingComplete = true;
		this.stopPolling();
		const result = await this.setState(sdp);
		console.log("[SignalManager] Sending answer to signaling server:", result);
		return result;
	}

	async runSignalStateMachine(webrtcManager, response = null) {
		if (!webrtcManager) {
			return null;
		}

		const currentResponse = response ?? (await this.getState());
		const previousState = this.currentState ?? null;
		const state = Number(currentResponse.state ?? 0);
		const data = currentResponse.data;
		this.currentState = state;

		if (previousState !== state) {
			console.log(
				`[SignalManager] State changed: ${previousState ?? "unknown"} -> ${state}`,
				{ data },
			);
			this.setStatus(
				`Signal state changed: ${previousState ?? "unknown"} -> ${state}`,
			);
		}

		if (state === 2 && this.hasSentOffer) {
			this.setStatus("Offer sent. Waiting for the peer answer at state 3.");
			return "wait";
		}

		if (state === 0) {
			this.setStatus("No active handshake found. Creating an offer.");
			return webrtcManager.createOffer();
		}

		if (state === 1 && data === "create offer") {
			this.setStatus("Peer discovered. Creating an offer.");
			return webrtcManager.createOffer();
		}

		if (state === 1 && data === "wait") {
			return "wait";
		}

		if (state === 2 && data && data !== "accepted") {
			if (this.hasSentOffer) {
				this.setStatus("Offer sent. Waiting for the peer answer at state 3.");
				return "wait";
			}

			this.setStatus("Offer received. Preparing automatic answer.");
			return webrtcManager.handleIncomingOffer({ sdp: data, candidates: [] });
		}

		if (state === 3 && data && data !== "accepted") {
			this.setStatus("Answer received. Completing peer connection.");
			return webrtcManager.handleIncomingAnswer({
				sdp: data,
				candidates: [],
			});
		}

		return "wait";
	}

	async autoNegotiate(webrtcManager) {
		this.webrtcManager = webrtcManager ?? this.webrtcManager;
		if (!this.webrtcManager) {
			return null;
		}

		this.startPolling();
		this.setStatus("Starting automatic negotiation");

		try {
			return await this.runSignalStateMachine(this.webrtcManager);
		} catch (error) {
			console.error("Automatic negotiation failed:", error);
			this.setStatus(
				"Automatic signaling setup failed. Check the server and browser console.",
			);
			return null;
		}
	}

	/**
	 * Clears the stored signaling handshake on the server after a successful
	 * connection so the same server slot can be reused for a future call.
	 * This intentionally does not reset the local live connection state.
	 */
	async clearAll() {
		const result = await this.fetchSignal("clear");
		console.log("[SignalManager] Clearing signaling state:", result);
		return result;
	}

	async addCandidate(type, candidate) {
		if (this.hasSentOffer || this.hasSentAnswer) {
			console.log(
				"[SignalManager] Ignoring ICE candidate update after offer/answer was already sent.",
			);
			return;
		}

		const candidateType = type.startsWith("Candidate")
			? type
			: `Candidate${type}`;
		const value =
			typeof candidate === "string" ? candidate : JSON.stringify(candidate);
		const entry = { type: candidateType, value };
		const alreadyQueued = this.pendingCandidates.some(
			(item) => item.type === candidateType && item.value === value,
		);

		if (!alreadyQueued) {
			this.pendingCandidates.push(entry);
		}

		if (this.pendingCandidateTimer) {
			clearTimeout(this.pendingCandidateTimer);
		}

		this.pendingCandidateTimer = setTimeout(async () => {
			const batch = [...this.pendingCandidates];
			this.pendingCandidates = [];
			this.pendingCandidateTimer = null;

			if (!batch.length) {
				return;
			}

			const payload = JSON.stringify({
				type: "ice-candidates",
				candidates: batch,
			});

			console.log(
				"[SignalManager] Debounced ICE candidate update scheduled for delivery:",
				batch,
			);
			await this.setState(payload);
		}, this.candidateFlushDelayMs);
	}

	async getOffer() {
		const response = await this.getState();
		const raw = response.data;
		if (
			!raw ||
			raw === "accepted" ||
			raw === "create offer" ||
			raw === "wait" ||
			raw === "no-op" ||
			raw === "cleared"
		) {
			return null;
		}
		if (response.state >= 2) {
			return { sdp: raw };
		}
		return null;
	}

	async getAnswer() {
		const response = await this.getState();
		const raw = response.data;
		if (
			!raw ||
			raw === "accepted" ||
			raw === "create offer" ||
			raw === "wait" ||
			raw === "no-op" ||
			raw === "cleared"
		) {
			return null;
		}
		if (response.state >= 3) {
			return { sdp: raw };
		}
		return null;
	}

	async getCandidates(type) {
		const payload = await this.fetchSignal(`candidates${type}`);
		const candidates = payload.candidates || [];
		return candidates.map((candidate) => {
			if (typeof candidate === "string") {
				try {
					return JSON.parse(candidate);
				} catch (error) {
					return candidate;
				}
			}
			return candidate;
		});
	}

	async pollSignalingState() {
		if (this.signalingComplete) {
			this.stopPolling();
			return;
		}
		console.log("poll triggered");

		try {
			const response = await this.getState();
			await this.runSignalStateMachine(this.webrtcManager ?? null, response);
		} catch (error) {
			console.warn("Failed to poll signaling state:", error);
			this.setStatus(
				"Unable to reach the signaling server. Check the URL and server status.",
			);
		}
	}
}
