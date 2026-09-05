# Security

## No authentication

SAWOT intentionally ships with **no authentication or authorization**. The
server:

- binds to `0.0.0.0` by default (configurable via `server.host` in
  `config.yaml`)
- exposes a WebSocket and REST API that can **control your Home Assistant
  devices** (lights, switches, climate, media players, locks, and more)
- stores chat history and uploads on disk under `data/`
- stores API keys for custom LLM providers **in plaintext** in
  `settings.json` (they are never returned by the API, but anyone with file
  access can read them)

Anyone who can reach the server on the network can issue device commands and
read conversation history. Treat it as a **trusted-LAN-only** service.

## Running it safely

- Bind to `127.0.0.1` (`server.host: "127.0.0.1"`) unless you specifically
  need access from other devices on your network.
- If you expose it on your LAN, keep it on a trusted network and **do not**
  port-forward it to the internet.
- The optional TLS (`tls:` in `config.yaml`) encrypts traffic and is
  required for phone microphone access, but it does **not** add
  authentication.

## Reporting a vulnerability

Please report security issues privately to <edmasoud@proton.me> rather than
opening a public issue.
