```javascript
const WebSocket = require("ws");

const wss = new WebSocket.Server({ port: 8080 });

wss.on("connection", (ws) => {
	ws.on("message", (message) => {
		// Broadcast to all other clients
		wss.clients.forEach((client) => {
			if (client !== ws && client.readyState === WebSocket.OPEN) {
				client.send(message);
			}
		});
	});

	ws.send(
		JSON.stringify({
			type: "welcome",
			message: "Connected to signaling server",
		}),
	);
});
```
