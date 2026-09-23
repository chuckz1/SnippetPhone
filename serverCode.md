```javascript
const cache = CacheService.getScriptCache();
const CACHE_KEY = "activeUsers";
const TTL_SECONDS = 21600; // 6 hours
const TIMEOUT_MS = 60 * 1000; // user expires after 1 minute

function loadUsers() {
	const raw = cache.get(CACHE_KEY);
	return raw ? JSON.parse(raw) : {};
}

function saveUsers(users) {
	cache.put(CACHE_KEY, JSON.stringify(users), TTL_SECONDS);
}

function pruneInactive(users) {
	const now = Date.now();
	for (const u in users) {
		if (now - users[u].lastSeen > TIMEOUT_MS) {
			delete users[u];
		}
	}
	return users;
}

/**
 * Handle ping with optional offer
 * Also returns answer if one is waiting
 */
function handlePing(users, username, offer) {
	const now = Date.now();
	const exists = !!users[username];

	if (offer) {
		// New user OR updating offer
		users[username] = {
			lastSeen: now,
			offer: offer,
			answer: users[username] ? users[username].answer : null,
		};
	} else {
		// No offer provided
		if (!exists || !users[username].offer) {
			return { error: "bad" };
		}
		users[username].lastSeen = now;
	}

	// Check for waiting answer
	let answer = null;
	if (users[username].answer) {
		answer = users[username].answer;
		users[username].answer = null; // consume answer
	}

	return { users, answer };
}

/**
 * Provide an answer to a specific user
 */
function handleProvideAnswer(users, target, answer) {
	if (!users[target]) {
		return { error: "bad" };
	}

	users[target].answer = answer;
	return { users };
}

/**
 * Get offer for a specific user
 */
function handleGetOffer(users, target) {
	if (!users[target] || !users[target].offer) {
		return { error: "bad" };
	}
	return { offer: users[target].offer };
}

function logoutUser(users, username) {
	delete users[username];
	return users;
}

function doGet(e) {
	const action = e.parameter.action;
	const username = e.parameter.username;
	const offer = e.parameter.offer;
	const target = e.parameter.target;
	const answer = e.parameter.answer;

	let users = loadUsers();
	users = pruneInactive(users);

	if (action === "ping") {
		if (!username) return ContentService.createTextOutput("Missing username");

		const result = handlePing(users, username, offer);
		if (result.error) return ContentService.createTextOutput(result.error);

		users = result.users;
		saveUsers(users);

		const response = {
			users: Object.keys(users),
			answer: result.answer || null,
		};

		return ContentService.createTextOutput(JSON.stringify(response));
	}

	if (action === "getOffer") {
		if (!target) return ContentService.createTextOutput("Missing target");

		const result = handleGetOffer(users, target);
		if (result.error) return ContentService.createTextOutput(result.error);

		return ContentService.createTextOutput(result.offer);
	}

	if (action === "sendAnswer") {
		if (!target || !answer) {
			return ContentService.createTextOutput("Missing target or answer");
		}

		const result = handleProvideAnswer(users, target, answer);
		if (result.error) return ContentService.createTextOutput(result.error);

		users = result.users;
		saveUsers(users);

		return ContentService.createTextOutput("ok");
	}

	if (action === "logout") {
		if (!username) return ContentService.createTextOutput("Missing username");

		users = logoutUser(users, username);
		saveUsers(users);

		return ContentService.createTextOutput("Logged out");
	}

	return ContentService.createTextOutput("Unknown action");
}
```
