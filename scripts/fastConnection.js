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
		const fastUrl = this._createFastUrl(username);
		const message =
			"Hi, this is " +
			username +
			". I am in a poor cell connection and need to reach you. " +
			"Please use this link to connect with me in SnippetPhone: " +
			fastUrl +
			" \n\nThis app lets us send short voice snippets instead of depending on a strong connection.";
		window.location.href = `sms:?body=${encodeURIComponent(message)}`;
	}

	sendFastUrlWithEmail(username) {
		const fastUrl = this._createFastUrl(username);
		const subject = "SnippetPhone: Quick contact while my connection is weak";
		const body =
			"Hi,\n\nThis is " +
			username +
			". I am currently in an area with poor cell service and need to reach you. " +
			"Please use this link to connect with me in SnippetPhone: \n" +
			fastUrl +
			"\n\nThis app is designed for short voice snippets when a normal cellular connection is unreliable.";
		window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
	}
}
