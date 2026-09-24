const serverURL =
	"https://script.google.com/macros/s/AKfycbzrDW6pei-ZNnki1AdPZBVxg3WbckDUhAphOHN2NbNgpUSHlvCkAwg7c53YXDreVesQhg/exec";

/**
 * Basic signaling manager scaffold.
 *
 * This class is intentionally lightweight and leaves the real signaling
 * transport implementation to the app when it is ready to connect.
 */
export class SignalingManager {
	constructor({
		onStatus = () => {},
		onUserUpdate = (users) => {},
		onAnswer = () => {},
		onRestart = () => {},
	} = {}) {
		this.onStatus = onStatus;
		this.onUserUpdate = onUserUpdate;
		this.onAnswer = onAnswer;
		this.onRestart = onRestart;
		this.userName = "";
		this.activeUsers = [];
		this.pollingHandle = null;
	}

	/**
	 * Send a status update to any listening callback.
	 *
	 * @param {string} message - Human-readable status message.
	 */
	setStatus(message) {
		this.onStatus(message);
	}

	/**
	 * Handle the response from a ping request to the signaling server.
	 *
	 * @param {object|string} response - The response from the server.
	 * @returns {boolean} - True if the response contained an updated users list, false otherwise.
	 */
	async handlePingResponse(response) {
		const rawText = await response.text();
		let data = null;

		if (rawText) {
			try {
				data = JSON.parse(rawText);
			} catch (error) {
				data = { raw: rawText };
			}
		}

		if (!response.ok) {
			throw new Error(`Ping failed (${response.status})`);
		}

		switch (true) {
			case data === "bad":
				// Server reported the request was invalid.
				this.setStatus("Server reported a bad request. Restarting...");
				this.onRestart();
				return false;
				break;
			case data?.answer !== undefined:
				// Server returned an answer payload.
				this.onAnswer(data.answer);
				return false;
				break;
			case Array.isArray(data?.users):
				// Server returned the standard ping payload with a users array.
				this.activeUsers = data.users;
				this.onUserUpdate(this.activeUsers);
				return true;
				break;
			default:
				break;
		}
		return false;
	}

	/**
	 * Initialize the signaling layer.
	 *
	 * This is intentionally left empty as a placeholder for future setup.
	 */
	async init(offerToken) {
		//send first ping with the offer token to the signaling server.
		if (!offerToken) {
			console.warn("init called without an offer token.");
			return;
		}

		if (!this.userName) {
			console.warn("init called without a username.");
			return;
		}

		const params = new URLSearchParams({
			action: "init",
			offer: offerToken,
		});
		const url = `${serverURL}?${params.toString()}`;

		try {
			const response = await fetch(url, {
				method: "GET",
				headers: {
					Accept: "application/json",
				},
			});

			const setup = await this.handlePingResponse(response);
			if (setup) {
				//start polling after successful setup
				this.startPolling();
			}
		} catch (error) {
			console.error("Error initializing signaling server:", error);
			this.setStatus("Unable to reach the signaling server during init.");
		}
	}

	/**
	 * Set the username for the signaling manager.
	 *
	 * @param {string} userName - The username to associate with this client.
	 */
	setUsername(userName) {
		this.userName = userName;
	}

	/**
	 * Start polling the signaling server for updates.
	 *
	 * Each ping keeps the current user's offer alive and returns the list of
	 * active peers. The app can use that list to decide who to call next.
	 *
	 * @param {number} intervalMs - How often to poll in milliseconds.
	 */
	startPolling(intervalMs = 5000) {
		this.stopPolling();
		this.pollingHandle = window.setInterval(() => {
			this.pollOnce();
		}, intervalMs);
	}

	/**
	 * Stop the polling loop if it is currently running.
	 */
	stopPolling() {
		if (this.pollingHandle) {
			window.clearInterval(this.pollingHandle);
			this.pollingHandle = null;
		}
	}

	/**
	 * Ping the signaling server so the server keeps this user active and returns
	 * any new peer data, such as the list of current users.
	 *
	 * @returns Nothing
	 */
	pollOnce() {
		if (!this.userName) {
			console.warn("pollOnce called without a username.");
			return;
		}

		const params = new URLSearchParams({
			action: "ping",
			username: this.userName,
		});
		const url = `${serverURL}?${params.toString()}`;

		// The Apps Script expects a simple GET request, not a JSON POST body.
		fetch(url, {
			method: "GET",
			headers: {
				Accept: "application/json",
			},
		})
			.then(async (response) => {
				await this.handlePingResponse(response);
			})
			.catch((error) => {
				console.error("Error pinging server:", error);
				this.setStatus("Unable to reach the signaling server.");
			});
	}
}
