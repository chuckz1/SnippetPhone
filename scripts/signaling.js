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

	async connect() {
		this.setStatus(`Connecting to signaling server: ${this.serverUrl}`);
		this.startPolling();

		try {
			await this.verifyServer();
			this.setStatus(
				"Signaling server found and connected. Starting automatic negotiation.",
			);
			return true;
		} catch (error) {
			console.warn("Signaling server verification failed:", error);
			this.setStatus(
				"Unable to reach the signaling server. Check the URL and server status.",
			);
			return false;
		}
	}

	async verifyServer() {
		const response = await fetch(this.buildSignalUrl("clear"));
		if (!response.ok) {
			throw new Error(`Server verification failed: ${response.status}`);
		}
		return true;
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
		const candidateType = type.startsWith("Candidate")
			? type
			: `Candidate${type}`;
		const url = this.buildSignalUrl(`add${candidateType}`, {
			candidate,
		});
		console.log(
			"[SignalManager] Sending ICE candidate to signaling server:",
			url,
		);
		await fetch(url);
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

		try {
			const response = await this.getState();
			const state = Number(response.state ?? 0);
			const data = response.data;

			if (state === 1 && data === "wait") {
				return;
			}

			if (state === 2 && data && data !== "accepted" && !this.hasSentOffer) {
				const offerSignature = JSON.stringify(data);
				if (offerSignature !== this.lastOfferSignature) {
					this.lastOfferSignature = offerSignature;
					this.onOffer({ sdp: data });
				}
				return;
			}

			if (state === 3 && data && data !== "accepted") {
				const answerSignature = JSON.stringify(data);
				if (answerSignature !== this.lastAnswerSignature) {
					this.lastAnswerSignature = answerSignature;
					this.onAnswer({ sdp: data });
					this.stopPolling();
				}
			}
		} catch (error) {
			console.warn("Failed to poll signaling state:", error);
			this.setStatus(
				"Unable to reach the signaling server. Check the URL and server status.",
			);
		}
	}
}
