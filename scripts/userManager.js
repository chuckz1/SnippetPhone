export class UserManager {
	constructor({ onStatus = () => {} } = {}) {
		this.onStatus = onStatus;
		this.userName = "";
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
	 * Get the current username.
	 *
	 * @returns {string} The current username.
	 */
	getUsername() {
		//first check for saved username in local storage
		const savedUserName = localStorage.getItem("userName");
		if (savedUserName) {
			this.userName = savedUserName;
		}

		return this.userName;
	}

	/**
	 * Set the current username.
	 *
	 * @param {string} userName - The new username to set.
	 */
	setUsername(userName) {
		this.userName = userName;
		localStorage.setItem("userName", userName);
	}

	/**
	 * Clear the current username.
	 */
	clearUsername() {
		this.userName = "";
		localStorage.removeItem("userName");
	}
}
