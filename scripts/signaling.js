const DEFAULT_SIGNALING_URL =
	"https://script.google.com/macros/s/AKfycbzrDW6pei-ZNnki1AdPZBVxg3WbckDUhAphOHN2NbNgpUSHlvCkAwg7c53YXDreVesQhg/exec";

/**
 * Coordinates the role-based signaling handshake without invoking WebRTC APIs.
 *
 * This manager owns the server interaction and polls the role-based endpoints described in the
 * docs. It only sends and receives SDP/candidate messages and emits callbacks to the caller so
 * the WebRTC layer stays focused on peer creation and session description handling.
 */
export class SignalManager {
	constructor({
		url = DEFAULT_SIGNALING_URL,
		onStatus = () => {},
		onRole = () => {},
		onOffer = () => {},
		onAnswer = () => {},
		onCandidate = () => {},
		pollIntervalMs = 1000,
	} = {}) {
		this.serverUrl = url;
		this.onStatus = onStatus;
		this.onRole = onRole;
		this.onOffer = onOffer;
		this.onAnswer = onAnswer;
		this.onCandidate = onCandidate;
		this.pollIntervalMs = pollIntervalMs;
		this.userId = null;
		this.role = null;
		this.handshakeState = "idle";
		this.pollTimer = null;
		this.lastRoleResponse = null;
	}

	// Publishes a status update to the UI and the console for the current handshake step.
	setStatus(message) {
		this.onStatus(message);
		console.log(`[SignalManager] ${message}`);
	}

	// Builds a URL for the Apps Script endpoint while preserving the server contract.
	buildSignalUrl(action, params = {}) {
		const query = new URLSearchParams({ action });
		Object.entries(params).forEach(([key, value]) => {
			if (value === undefined || value === null) {
				return;
			}
			query.append(key, String(value));
		});
		return `${this.serverUrl}?${query.toString()}`;
	}

	// Normalizes restart responses and other server payloads into a predictable shape.
	async fetchSignal(action, params = {}) {
		const url = this.buildSignalUrl(action, params);
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Signal fetch failed for ${action}: ${response.status}`);
		}

		const text = await response.text();
		if (!text) {
			return { status: "empty", data: null };
		}

		try {
			const payload = JSON.parse(text);
			if (
				payload &&
				(payload.status === "restart" || payload.state === "restart")
			) {
				this.resetSession(
					"The signaling server requested a restart. Re-run the role assignment flow.",
				);
			}
			return payload;
		} catch (error) {
			console.warn(`Non-JSON response for ${action}:`, text);
			return { status: "empty", data: null };
		}
	}

	// Clears local role/session state so the next handshake begins from a fresh assignment.
	resetSession(message = "Resetting the current signaling session.") {
		this.userId = null;
		this.role = null;
		this.handshakeState = "idle";
		this.lastRoleResponse = null;
		this.setStatus(message);
	}

	// Requests the role assignment from the signaling server for the current caller.
	async getRole() {
		const payload = await this.fetchSignal("getRole");
		if (!payload || payload.status === "restart") {
			return payload;
		}

		this.lastRoleResponse = payload;
		this.userId = payload.userId ?? this.userId;
		this.role = payload.role ?? this.role;
		this.handshakeState = payload.state ?? this.handshakeState;
		this.onRole({
			userId: this.userId,
			role: this.role,
			state: this.handshakeState,
			response: payload,
		});
		this.setStatus(
			`Assigned signaling role ${this.role ?? "unknown"} for user ${this.userId ?? "?"}.`,
		);
		return payload;
	}

	// Alias for the explicit role request flow in the docs.
	async requestRole() {
		return this.getRole();
	}

	// Sends the offer SDP to the server using the active userId.
	async sendOffer(sdp, userId = this.userId) {
		if (userId === null || userId === undefined) {
			throw new Error("A valid userId is required before sending an offer.");
		}
		if (typeof sdp !== "string" || !sdp.trim()) {
			throw new Error("Offer SDP must be a non-empty string.");
		}
		return this.fetchSignal("sendOffer", { userId, data: sdp });
	}

	// Sends one ICE candidate to the offerer role bucket on the server.
	async sendOfferIceCandidate(candidate, userId = this.userId) {
		const serialized =
			typeof candidate === "string" ? candidate : JSON.stringify(candidate);
		return this.fetchSignal("sendOfferICE", { userId, data: serialized });
	}

	// Sends the answer SDP to the server using the active userId.
	async sendAnswer(sdp, userId = this.userId) {
		if (userId === null || userId === undefined) {
			throw new Error("A valid userId is required before sending an answer.");
		}
		if (typeof sdp !== "string" || !sdp.trim()) {
			throw new Error("Answer SDP must be a non-empty string.");
		}
		return this.fetchSignal("sendAnswer", { userId, data: sdp });
	}

	// Sends one ICE candidate to the answerer role bucket on the server.
	async sendAnswerIceCandidate(candidate, userId = this.userId) {
		const serialized =
			typeof candidate === "string" ? candidate : JSON.stringify(candidate);
		return this.fetchSignal("sendAnswerICE", { userId, data: serialized });
	}

	// Returns the current offer payload for this user, if any is waiting in the server state.
	async getOffer(userId = this.userId) {
		if (userId === null || userId === undefined) {
			return null;
		}

		const payload = await this.fetchSignal("getOffer", { userId });
		if (!payload || payload.status === "restart") {
			return null;
		}

		const sdp = payload.offerSdp ?? payload.data ?? payload.sdp ?? null;
		if (
			!sdp ||
			sdp === "accepted" ||
			sdp === "create offer" ||
			sdp === "wait" ||
			sdp === "no-op" ||
			sdp === "cleared"
		) {
			return null;
		}

		return {
			userId: payload.userId ?? userId,
			sdp,
			candidates: await this.getOfferIceCandidates(userId),
		};
	}

	// Returns the current answer payload for this user, if any has been stored by the peer.
	async getAnswer(userId = this.userId) {
		if (userId === null || userId === undefined) {
			return null;
		}

		const payload = await this.fetchSignal("getAnswer", { userId });
		if (!payload || payload.status === "restart") {
			return null;
		}

		const sdp = payload.answerSdp ?? payload.data ?? payload.sdp ?? null;
		if (
			!sdp ||
			sdp === "accepted" ||
			sdp === "create offer" ||
			sdp === "wait" ||
			sdp === "no-op" ||
			sdp === "cleared"
		) {
			return null;
		}

		return {
			userId: payload.userId ?? userId,
			sdp,
			candidates: await this.getAnswerIceCandidates(userId),
		};
	}

	// Normalizes the candidate list returned by the server into a consistent array shape.
	normalizeCandidateList(payload) {
		const candidates = payload?.iceCandidates ?? payload?.candidates ?? [];
		if (!Array.isArray(candidates)) {
			return [];
		}

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

	// Fetches pending ICE candidates stored for the offerer side.
	async getOfferIceCandidates(userId = this.userId) {
		if (userId === null || userId === undefined) {
			return [];
		}
		const payload = await this.fetchSignal("getOfferICE", { userId });
		if (!payload || payload.status === "restart") {
			return [];
		}
		return this.normalizeCandidateList(payload);
	}

	// Fetches pending ICE candidates stored for the answerer side.
	async getAnswerIceCandidates(userId = this.userId) {
		if (userId === null || userId === undefined) {
			return [];
		}
		const payload = await this.fetchSignal("getAnswerICE", { userId });
		if (!payload || payload.status === "restart") {
			return [];
		}
		return this.normalizeCandidateList(payload);
	}

	// Starts the polling loop that listens for server updates for the current role.
	startPolling() {
		if (this.pollTimer) {
			return;
		}

		this.setStatus("Starting role-based signaling polling.");
		this.pollOnce();
		this.pollTimer = setInterval(() => this.pollOnce(), this.pollIntervalMs);
	}

	// Stops the polling loop when the remote peer has been answered or the session is reset.
	stopPolling() {
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
		this.handshakeState = "idle";
	}

	// Polls the current role bucket for remote SDP and ICE traffic without touching WebRTC APIs.
	async pollOnce() {
		if (!this.userId || !this.role) {
			return;
		}

		try {
			if (this.role === "answerer") {
				const offer = await this.getOffer(this.userId);
				if (offer && offer.sdp) {
					this.onOffer({ sdp: offer.sdp, candidates: offer.candidates ?? [] });
				}
				const offerCandidates = await this.getOfferIceCandidates(this.userId);
				for (const candidate of offerCandidates) {
					this.onCandidate({ candidate });
				}
			}

			if (this.role === "offerer") {
				const answer = await this.getAnswer(this.userId);
				if (answer && answer.sdp) {
					this.onAnswer({
						sdp: answer.sdp,
						candidates: answer.candidates ?? [],
					});
				}
				const answerCandidates = await this.getAnswerIceCandidates(this.userId);
				for (const candidate of answerCandidates) {
					this.onCandidate({ candidate });
				}
			}
		} catch (error) {
			console.warn("Failed to poll the role-based signaling state:", error);
			this.setStatus(
				"Unable to reach the signaling server. Check the URL and browser console.",
			);
		}
	}

	// Runs the role assignment flow and then delegates the transport work back to the caller.
	async beginHandshake(callbacks = {}) {
		const {
			onCreateOffer,
			onRemoteOffer = this.onOffer,
			onRemoteAnswer = this.onAnswer,
			onRemoteCandidate = this.onCandidate,
		} = callbacks;

		const roleResponse = await this.getRole();
		if (!roleResponse || roleResponse.status === "restart") {
			return null;
		}

		this.onOffer = onRemoteOffer;
		this.onAnswer = onRemoteAnswer;
		this.onCandidate = onRemoteCandidate;

		if (this.role === "offerer" && typeof onCreateOffer === "function") {
			const offerPayload = await onCreateOffer();
			if (offerPayload && offerPayload.sdp) {
				await this.sendOffer(offerPayload.sdp, this.userId);
				for (const candidate of offerPayload.candidates ?? []) {
					await this.sendOfferIceCandidate(candidate, this.userId);
				}
			}
		}

		this.startPolling();
		return roleResponse;
	}

	// Clears all signaling state using the server-side reset endpoint.
	async clearServer() {
		const result = await this.fetchSignal("clearServer");
		console.log("[SignalManager] Clearing signaling state:", result);
		return result;
	}

	// Backward-compatible alias for older call sites.
	async clearAll() {
		return this.clearServer();
	}
}
