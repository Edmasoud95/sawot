# Security

## No authentication

SAWOT currently ships with **no authentication or authorization**.
Authentication is planned but not yet implemented. The server:

- binds to `0.0.0.0` by default (configurable via `server.host` in
  `config.yaml`)
- exposes a WebSocket and REST API that can **control your Home Assistant
  devices** (lights, switches, climate, media players, locks, and more)
- stores chat history and uploads on disk under `data/`
- stores Home Assistant, Brave Search, Hugging Face, and custom provider
  credentials **in plaintext** in
  `settings.json` (they are never returned by the API; new backend writes
  restrict the file to its owner, but filesystem access still needs protection)

Anyone who can reach the server on the network can issue device commands and
read conversation history. Treat it as a **trusted-LAN-only** service.

## Running it safely

- Configure `server.allowed_origins` with the exact HTTP(S) origins used to
  open the voice interface (scheme, hostname and non-default port, without a
  path or trailing slash). Alternatively, set `SAWOT_ALLOWED_ORIGINS` to a
  comma-separated list. The environment variable overrides YAML, including
  when empty. Missing configuration denies all voice WebSocket connections.
  Missing, `null`, and unlisted Origin headers are rejected. Reverse proxies
  must preserve the browser's Origin header. This mitigates cross-site
  WebSocket access; it is not authentication, and non-browser clients can
  forge Origin. REST endpoints still require trusted-network protection.

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
