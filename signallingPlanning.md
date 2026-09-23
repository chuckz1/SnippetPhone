# Signalling Planning

Signalling will be sent to an app script that handles the exchange of WebRTC tokens between peers.
It must use only simple get requests to prevent cors preflight checks.

# Implementation Details

# Endpoints

### ping

- clients sends a ping request, first time with username and offer attached.
- after that, it just sends username in pings. pings keep the client offer from being deleted after 1 minute.
- this returns a list of usernames of active users.

### getOffer

- retrieves the offer for a specific target user.

### sendAnswer

- provides an answer to a specific target user.

### logout

- logs out the current user.

offers will be sent to the server with a simple username attached to them. the server will add a timestamp and store them. server will provide every offer with a unique identifier. the offerer will poll the server to check the status of their offer.

Clients can then retrieve a list of stored offers from the server, select the appropriate one, and generate an answer token to send back.

write a basic app script. it must all use basic get requests to avoid cors. users will send a request to get all active users. the request will send their own user name. no passwords needed. the server will store a list of logged in users. server will store timestamp to remove users after 1 min of no activity. the server will respond with the list of active users. also have an endpoint to log out users.
