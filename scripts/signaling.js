const serverURL =
	"https://script.google.com/macros/s/AKfycbzrDW6pei-ZNnki1AdPZBVxg3WbckDUhAphOHN2NbNgpUSHlvCkAwg7c53YXDreVesQhg/exec";
const serverRetryInterval = 5000; // Retry interval in milliseconds if the server is unreachable.
const serverRetryCount = 3; // Number of times to retry if the server is unreachable.

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
		getAnswerToken = (offer) => {},
		onAnswer = (answer) => {},
		onRestart = () => {},
	} = {}) {
		this.onStatus = onStatus;
		this.onUserUpdate = onUserUpdate;
		this.getAnswerToken = getAnswerToken;
		this.onAnswer = onAnswer;
		this.onRestart = onRestart;
		this.userName = "";
		this.targetUser = "";
		this.activeUsers = [];
		this.pollingHandle = null;
		this.loggedIn = false;
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
	 * Send a message to the signaling server.
	 * Handles ensuring the message is properly sent to the server.
	 * and retrying if necessary.
	 *
	 * @param {URLSearchParams} params - The parameters to send to the server.
	 * @param {function} responseCallback - Optional callback to handle the server response. This is expected to return true if the response was successfully handled, false otherwise.
	 */
	async _sendSeverMessage(
		params,
		responseCallback,
		errorMessage = "Unable to reach the signaling server.",
	) {
		const url = `${serverURL}?${params.toString()}`;
		let lastError = null;

		for (let attempt = 1; attempt <= serverRetryCount; attempt++) {
			try {
				const response = await fetch(url, {
					method: "GET",
					headers: {
						Accept: "application/json",
					},
				});

				if (!response.ok) {
					throw new Error(`Server responded with status ${response.status}`);
				}

				if (responseCallback) {
					const handled = await responseCallback.call(this, response);
					if (!handled) {
						throw new Error("Server response was not handled successfully.");
					}
				}

				return;
			} catch (error) {
				lastError = error;
				console.error(
					`Error sending message to server (attempt ${attempt}/${serverRetryCount}):`,
					error,
				);
				this.setStatus(errorMessage);

				if (attempt < serverRetryCount) {
					await new Promise((resolve) => {
						window.setTimeout(resolve, serverRetryInterval);
					});
				}
			}
		}

		console.error("Error sending message to server after retries:", lastError);
		this.setStatus(errorMessage);

		//wait one more retry interval before calling restart
		await new Promise((resolve) => {
			window.setTimeout(resolve, serverRetryInterval);
		});
		this.onRestart();
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

		switch (true) {
			case data === "bad":
				// Server reported the request was invalid.
				this.setStatus("Server reported a bad request. Restarting...");
				this.onRestart();
				break;
			case data?.answer !== undefined && data?.answer !== null:
				// Server returned an answer payload.
				this.onAnswer(data.answer);
				break;
			case Array.isArray(data?.users):
				// Server returned the standard ping payload with a users array.
				this.activeUsers = data.users;

				// remove ourself from the list of active users
				this.activeUsers = this.activeUsers.filter(
					(user) => user !== this.userName,
				);
				console.log("Active users after removing self:", this.activeUsers);

				this.onUserUpdate(this.activeUsers);
				// Restart polling after updating the users list.
				this.startPolling();
				break;
			default:
				// Server returned an unexpected payload.
				console.warn("Unexpected response from server:", data);
				this.setStatus("Unexpected response from server.");
				return false;
				break;
		}
		return true;
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
			action: "ping",
			username: this.userName,
			offer: offerToken,
		});

		this.loggedIn = true;
		await this._sendSeverMessage(
			params,
			this.handlePingResponse,
			"Error initializing signaling server",
		);
	}

	async handleOfferResponse(response) {
		const offer = await response.text();

		console.log("offer received: ", offer);

		// get answer
		const answerToken = await this.getAnswerToken(offer);

		// send the answer back to the signaling server
		this._sendAnswer(this.targetUser, answerToken);

		return true;
	}

	async requestOffer(targetUser) {
		// username is not needed for fast connection request
		// if (!this.userName) {
		// 	console.warn("requestOffer called without a username.");
		// 	return;
		// }

		if (!targetUser) {
			console.warn("requestOffer called without a target user.");
			return;
		}

		// save for later
		this.targetUser = targetUser;

		const params = new URLSearchParams({
			action: "getOffer",
			// username: this.userName,
			target: targetUser,
		});

		await this._sendSeverMessage(
			params,
			this.handleOfferResponse,
			"Error requesting offer from signaling server",
		);
	}

	async _sendAnswer(targetUser, answerToken) {
		if (!answerToken) {
			console.warn("sendAnswer called without an answer token.");
			return;
		}

		if (!targetUser) {
			console.warn("sendAnswer called without a target user.");
			return;
		}

		// username is not needed for fast connection answer
		// if (!this.userName) {
		// 	console.warn("sendAnswer called without a username.");
		// 	return;
		// }

		const params = new URLSearchParams({
			action: "sendAnswer",
			username: this.userName,
			target: targetUser,
			answer: answerToken,
		});

		await this._sendSeverMessage(
			params,
			async (response) => {
				const text = await response.text();
				return text.toLowerCase().includes("ok");
			},
			"Error sending answer to signaling server",
		);
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
	 * Log out the current user and clear the username and target user.
	 */
	async logOut() {
		if (!this.loggedIn) {
			return;
		}

		console.log("Logging out from signaling server.");
		this.stopPolling();

		// send message to server to log out the current user
		const params = new URLSearchParams({
			action: "logout",
			username: this.userName,
		});

		await this._sendSeverMessage(
			params,
			null,
			"Error logging out from signaling server",
		);

		this.loggedIn = false;
		this.targetUser = null;
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
		if (this.pollingHandle) {
			// Polling is already running, no need to start another interval.
			return;
		}

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
		this.loggedIn = true;

		this._sendSeverMessage(
			params,
			this.handlePingResponse,
			"Error pinging signaling server",
		);
	}
}
