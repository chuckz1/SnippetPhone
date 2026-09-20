const DEFAULT_SIGNALING_URL =
	"https://toward-independence-cyber-bathroom.trycloudflare.com";

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
		this.pollTimer = null;
		this.lastOfferSignature = "";
		this.lastAnswerSignature = "";
		this.seenCandidates = new Set();
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
			console.log(
				"[SignalManager] Signaling server found and connected. Starting automatic negotiation.",
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
		const response = await fetch(`${this.serverUrl}?action=offer`);
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

	async fetchSignal(action) {
		const url = `${this.serverUrl}?action=${encodeURIComponent(action)}`;
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Signal fetch failed for ${action}: ${response.status}`);
		}

		const text = await response.text();
		if (!text) {
			return {};
		}

		try {
			return JSON.parse(text);
		} catch (error) {
			console.warn(`Non-JSON response for ${action}:`, text);
			return {};
		}
	}

	async setOffer(sdp) {
		const url = `${this.serverUrl}?action=setOffer&sdp=${encodeURIComponent(sdp)}`;
		console.log("[SignalManager] Sending offer to signaling server:", url);
		await fetch(url);
	}

	async setAnswer(sdp) {
		const url = `${this.serverUrl}?action=setAnswer&sdp=${encodeURIComponent(sdp)}`;
		console.log("[SignalManager] Sending answer to signaling server:", url);
		await fetch(url);
	}

	async addCandidate(type, candidate) {
		const candidateType = type.startsWith("Candidate")
			? type
			: `Candidate${type}`;
		const url = `${this.serverUrl}?action=add${candidateType}&candidate=${encodeURIComponent(candidate)}`;
		console.log(
			"[SignalManager] Sending ICE candidate to signaling server:",
			url,
		);
		await fetch(url);
	}

	async getOffer() {
		const payload = await this.fetchSignal("offer");
		const raw = payload.offer;
		if (!raw) {
			return null;
		}
		if (typeof raw === "string") {
			try {
				return JSON.parse(raw);
			} catch (error) {
				return { sdp: raw };
			}
		}
		return raw;
	}

	async getAnswer() {
		const payload = await this.fetchSignal("answer");
		const raw = payload.answer;
		if (!raw) {
			return null;
		}
		if (typeof raw === "string") {
			try {
				return JSON.parse(raw);
			} catch (error) {
				return { sdp: raw };
			}
		}
		return raw;
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
		try {
			const offer = await this.getOffer();
			const offerSignature = JSON.stringify(offer || null);
			if (offer && offerSignature !== this.lastOfferSignature) {
				this.lastOfferSignature = offerSignature;
				const offerMessage =
					typeof offer === "string" ? { sdp: offer } : { sdp: offer.sdp };
				this.onOffer(offerMessage);
			}

			const answer = await this.getAnswer();
			const answerSignature = JSON.stringify(answer || null);
			if (answer && answerSignature !== this.lastAnswerSignature) {
				this.lastAnswerSignature = answerSignature;
				const answerMessage =
					typeof answer === "string" ? { sdp: answer } : { sdp: answer.sdp };
				this.onAnswer(answerMessage);
			}

			for (const type of ["A", "B"]) {
				const candidates = await this.getCandidates(type);
				for (const candidate of candidates) {
					const candidateSignature = JSON.stringify(candidate);
					if (!this.seenCandidates.has(candidateSignature)) {
						this.seenCandidates.add(candidateSignature);
						this.onCandidate({ candidate });
					}
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
