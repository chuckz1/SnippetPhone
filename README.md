# SnippetPhone

This project is a minimal static WebRTC demo that can be hosted on GitHub Pages.

## How it works

- One client creates an offer token.
- The offer token is copied and pasted into the second client.
- The second client generates an answer token.
- The answer token is copied back to the first client.
- The peer connection is then completed and live voice starts.

Because GitHub Pages is static hosting, there is no backend or signaling server. The offer/answer payloads are transferred manually by copy-paste.

## Local preview

Open the project in a browser directly or serve it locally:

```bash
cd c:/Users/fehri/Desktop/Projects/SnippetPhone
python -m http.server 8000
```

Then visit:

```text
http://localhost:8000
```

## GitHub Pages deployment

1. Push this project to a GitHub repository.
2. Open the repository in GitHub.
3. Go to Settings > Pages.
4. Choose the branch to publish, usually `main`.
5. Set the folder to `/root` or `/` depending on the repository structure.
6. Save and wait for the site to publish.

## Notes

- This is meant as a starting point for a poor-network voice app.
- The browser will ask for microphone permission on both clients.
- For a real production app, you would replace the manual token exchange with a signaling service such as WebSockets, Firebase, or a custom server.
