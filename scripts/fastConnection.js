// fast connection steps
// users can send a link to other for a fast connection
// the second user doesn't register with the main user system
// the link will have the target username in it

// 1. Skip getting username. use "Temp" if needed
// 2. skip sending ping. directly ask for target user offer provided by link
// 3. generate answer based on received offer
// 4. send answer to signaling server
// 5. establish direct connection with remote peer

export class FastConnectionManager {
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
	 * Determine if the current connection should be treated as a fast connection.
	 *
	 * @returns {boolean} True if this is a fast connection, false otherwise.
	 */
	isFastConnection() {
		//check if there is a target specified in the URL
		const urlParams = new URLSearchParams(window.location.search);
		return urlParams.has("target");
	}

	/**
	 * Retrieve the target for the fast connection.
	 *
	 * @returns {string|null} The target user for the fast connection, or null if not available.
	 */
	getFastTarget() {
		// Extract the target username from the link or other source
		const urlParams = new URLSearchParams(window.location.search);
		return urlParams.get("target") || null;
	}

	/**
	 * Create a fast connection URL with the specified target user.
	 *
	 * @param {string} username - The target user for the fast connection.
	 * @returns {string} The generated URL containing the target user parameter.
	 */
	_createFastUrl(username) {
		const url = new URL(window.location.href);
		url.searchParams.set("target", username);
		return url.toString();
	}

	sendFastUrlWithText(username) {
		//placeholder to open the default text messaging app with the fast connection URL & pre-filled message
		const fastUrl = this._createFastUrl(username);
		// Example: open the default messaging app with the fast URL
		window.location.href = `sms:?body=${encodeURIComponent(fastUrl)}`;
	}

	sendFastUrlWithEmail(username) {
		//placeholder to open the default email client with the fast connection URL & pre-filled message
		const fastUrl = this._createFastUrl(username);
		// Example: open the default email client with the fast URL
		window.location.href = `mailto:?subject=Fast Connection&body=${encodeURIComponent(fastUrl)}`;
	}
}
