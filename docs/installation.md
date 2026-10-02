# Installation and first run

[← Back to SAWOT](../README.md)

## Before you install

You need:

- **Optional Home Assistant connection:** add its URL and a long-lived access
  token in Settings when you want home tools. General chat and startup do not
  require Home Assistant credentials.
- **A language model endpoint.** SAWOT does not bundle or start an LLM server.
  Use an OpenAI-compatible local server, or configure a hosted provider after
  opening the UI. Home control and search require tool calling; pictures
  require image input support.
- **Internet access for initial installation and model downloads.** Some
  models require accepting Hugging Face access terms and saving a Hugging Face token in Settings.
  Local inference can run without cloud services after its dependencies and
  model assets are cached; hosted models and web search remain online features.
- **Storage for models and conversations.** The catalogue estimates about
  731 MB for the default Parakeet STT and 327 MB for Kokoro, excluding Python,
  PyTorch, other caches, and the LLM. Optional Chatterbox downloads are larger.

Choose Docker for the packaged CPU deployment, or native Linux/WSL2 for direct
control of Python dependencies and optional GPU speech synthesis.

## Docker setup

The published image targets **Linux x86_64 (`linux/amd64`) and CPU inference**.
The included Compose file mounts `./data` at `/data` inside the container.

### 1. Get the project and configure the model endpoint

```bash
git clone https://github.com/Edmasoud95/sawot.git
cd sawot
cp .env.example .env
```

Set `LLM_URL` in `.env` to your model server's
OpenAI-compatible base URL, including `/v1`, and optionally set `LLM_MODEL` to
its exact model ID. The Compose default is
`http://host.docker.internal:1234/v1`; `host.docker.internal` addresses the
Docker host, not the container. A server on another machine needs that
machine's reachable LAN address.

### 2. Enable your browser origin and prepare uploads

Create `docker-compose.override.yml` beside `docker-compose.yml`:

```yaml
services:
  sawot:
    environment:
      SAWOT_ALLOWED_ORIGINS: "http://localhost:8765"
```

The origin must exactly match the address you open in the browser. For phone
access, replace or extend it with your trusted HTTPS origin; see
[Phone access](#phone-access-and-https). Separate multiple origins with commas,
without paths or trailing slashes.

The base Compose file does not forward `SAWOT_ALLOWED_ORIGINS`. The override
above enables it. Configure credentials in Settings after starting the app.

```bash
mkdir -p data/data/uploads
docker compose up -d
```

Use `docker compose up -d --build` instead when you want to build the current
checkout, including local changes, rather than run the published image.

### 3. Open the UI and select models

Open **http://localhost:8765**, then follow [First run](#first-run).
For startup logs:

```bash
docker compose logs -f sawot
```

To update the published image while keeping the mounted data:

```bash
docker compose pull
docker compose up -d
```

`latest` follows main. Pin an available image tag or digest in Compose if you
need a repeatable deployment. Back up `./data` before upgrades.

## Native setup

Use Linux or WSL2, **Python 3.12** and **Node.js 22** to match the container and
CI. The project declares Python 3.10 or newer, but native speech dependencies
also need compatible wheels. The packaged speech stack targets x86_64.

### 1. Install dependencies

With Python and Node already installed, on Debian/Ubuntu:

```bash
sudo apt update
sudo apt install -y git python3-venv espeak-ng ffmpeg libsndfile1
git clone https://github.com/Edmasoud95/sawot.git
cd sawot
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m spacy download en_core_web_sm
cp config.example.yaml config.yaml
cp .env.example .env
mkdir -p data/uploads
```

### 2. Configure a localhost installation

Edit `.env`: set `LLM_URL`/`LLM_MODEL` if desired. Configure Home Assistant
from Settings after starting the app.

In `config.yaml`:

- Replace the example model-server address.
- Set `server.host` to `127.0.0.1` for access only from this machine.
- Set `server.allowed_origins` to `["http://localhost:8765"]`.
- **Remove or comment out the example `tls:` block** for this HTTP localhost
  setup. It references certificate files that are not included.

For LAN access, choose the appropriate bind address and configure trusted HTTPS
before using a phone microphone or camera. Under WSL2, a model server on Windows
must be reachable from WSL; do not assume WSL's `localhost` reaches it.

### 3. Build and start

```bash
(cd ts-backend && npm ci && npm run build)
(cd web && npm ci && npm run build)
./run.sh
```

Open **http://localhost:8765**. The launcher runs the Python speech sidecar on
loopback port 8766 and the TypeScript backend on port 8765. Initial speech
loading or downloads can delay readiness. Stop the launcher with Ctrl+C.

`run.sh` only builds missing `dist/` directories. After updating source code,
repeat both build commands and restart it.

## First run

1. Open **Settings → Connections**. For home control, enter your Home Assistant
   server URL and long-lived access token. This connection is optional.
   Add custom model providers under **AI providers** using their OpenAI-compatible
   base URL and API key.
2. In **Settings → Assistant**, select a model with tool calling for voice/home
   tasks. Choose the personality and optional drawing detail. Chat also has its
   own model picker and instructions.
3. For voice or dictation, in **Settings → Speech**, download and select an STT model and a TTS model.
   The catalogue defaults are **Parakeet Unified EN** (English only) and
   **Kokoro**. Choose a multilingual STT model when needed and a matching voice.
   Kokoro may fetch assets during the first startup if they are not cached yet.
4. Grant microphone permission and try a general question. For pictures, choose
   a model that accepts images before attaching them.
5. For search, save your Brave Search API key in **Settings → Connections**.
   Changes apply to new requests without a restart. Enable search in the chat's
   tools menu when wanted. Optional Hugging Face tokens for gated model downloads
   are configured in the same section.

A responsive `/health` endpoint confirms the backend is running; it does not
prove that speech models, your LLM, or Home Assistant are ready.

### Optional Chatterbox speech and voice cloning

The standard dependency set and Docker image do not install Chatterbox.
For a native installation, follow [requirements-chatterbox.txt](../requirements-chatterbox.txt)
for the optional package commands and compatible PyTorch/torchaudio builds.
Then download and select **Chatterbox Turbo** or **Chatterbox Nano** in Speech
settings. Using it in Docker requires a custom image with those dependencies.

Record a short sample under **Cloned voices**, name it, and select it as the
voice. Cloned clips are used by Chatterbox, not Kokoro. Choose **default** to return
to Chatterbox’s built-in voice after using a clone. Turbo and Nano can use
sound tags such as `[laugh]`; those tags are removed from captions and history.
Style tags such as `[whispering]` are not suggested because they had no audible
effect in the project's Turbo checks.

## Phone access and HTTPS

Microphone and live camera capture need a secure browser context. HTTP on
`localhost` works for local development; an ordinary HTTP LAN address does not
provide that exception on a phone.

1. Give the server an HTTPS address reachable on your trusted LAN and a
   certificate the phone trusts. Configure `tls.certfile` and `tls.keyfile` for
   direct backend TLS, or terminate HTTPS at a reverse proxy that supports
   WebSocket upgrades and preserves the browser's `Origin` header.
2. Add that exact HTTPS origin to `server.allowed_origins` or
   `SAWOT_ALLOWED_ORIGINS`, and restart the backend. A missing or empty allowlist
   rejects voice WebSockets.
3. Open that address on the phone and grant microphone/camera permissions.
   Dismissing a self-signed certificate warning alone is not a reliable setup;
   the device must trust the certificate.
4. Use the browser's **Add to Home Screen** or **Install app** action for a
   standalone window. This is a server-connected app, not an offline assistant.

In Docker, direct TLS also requires mounting the certificate/key and forwarding
`TLS_CERTFILE` and `TLS_KEYFILE` in Compose. Keep certificates out of Git.
HTTPS does not replace trusted-network restrictions or add a login.
