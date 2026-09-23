# SAWOT

**A voice and chat assistant for Home Assistant, with an animated ink orb.**

Talk to your home, ask questions, discuss pictures, or open a general-purpose
chat. SAWOT combines local speech recognition and speech synthesis with a model
server of your choice. Use a local LLM for a local setup, or add hosted
OpenAI-compatible providers from Settings.

**Work in progress:** features and setup can change between commits. See
[known limitations](#known-limitations) before installing.

> **Trusted LAN only.** SAWOT has no login or user permissions. Anyone who can
> reach the server can read conversations and issue Home Assistant commands.
> HTTPS and the voice-origin allowlist do not add authentication. Do not expose
> it to the internet. Read [SECURITY.md](SECURITY.md).

![SAWOT voice screen with the resting ink orb](screenshots/voice.png)

[Features](#features) · [Screenshots](#screenshots) ·
[Docker setup](#docker-setup) · [Native setup](#native-setup) ·
[Phone access](#phone-access-and-https) · [Limitations](#known-limitations)

## Features

### Voice and pictures

- **Hands-free voice:** tap the microphone to start a session. A soft cue and
  teal listening orb signal that capture is ready. Speak naturally; about 1.4
  seconds of quiet sends the turn, or tap to send sooner. The microphone stays
  ready across replies, with captions and spoken answers.
- **Interrupt a reply:** tap the microphone to interrupt and listen again.
  Choose **End** or press Escape to release the microphone. Switching to chat,
  leaving the page, or losing the connection also ends the session. Pending
  results are discarded; device actions already sent to Home Assistant cannot
  be undone by interruption.
- **Ask about pictures:** attach up to four images to a voice turn, then ask a
  question aloud or use **Send pictures**. Requires an image-capable model.
- **Camera, Photo library, and Files:** take a picture or select an existing
  image. File selection remains available if live camera capture fails.
- **Session history:** revisit voice turns in the history drawer.
- **Keyboard and reduced-motion support:** the microphone works with Space or
  Enter, and the orb respects the browser's reduced-motion preference.

### An orb that responds

- **Moving ink:** 6,144 persistent particles gather into shapes, form a knot
  while thinking, and react to speech playback.
- **28 catalogue expressions:** faces, home devices, weather, and status symbols.
- **Readouts and sketches:** short text or numbers, simple drawings, and an
  optional detailed-drawing mode. The model chooses what to show; drawing
  quality depends on the model.
- **Verified temperatures:** numeric temperature expressions use validated
  readings returned by Home Assistant during the turn.
- **Quiet captions:** expression markers stay out of speech and visible history.

### Home Assistant

- **Read and control entities** through model tool calls.
- **Device cards** for entities used in a reply, available in the Devices view
  and inline in chats with Home Assistant enabled.
- **Touch controls** for lights and switches, brightness, colour temperature,
  light colour, and thermostat targets where supported by the entity.
- **Optional home tools in chat:** enable Home Assistant per conversation.
  Voice mode is home-aware by default.

### General-purpose chat

- **Multiple saved conversations** with automatic titles, deletion,
  and a model choice for each conversation.
- **Streaming replies**, collapsible model reasoning when supplied, Markdown,
  and highlighted code blocks.
- **Chat commands:** `/status` shows the current model and estimated conversation
  context used, capacity, and remaining space; `/help` lists commands. Estimates
  include instructions, enabled tools, and readable attachments, with a rough
  allowance for images. Capacity is labelled as LM Studio reported or assumed.
  Results open in a dismissible drawer. Commands and results are not saved in
  the conversation and do not call the model or enter its context.
  Type `/` in the composer to browse command suggestions. Use arrow keys and
  Enter or Tab, or tap a suggestion, to insert it; send when ready. Escape closes
  the suggestions.
- **Mobile conversation view** with history behind a menu and a compact model
  picker beside the composer controls.
- **Saved text drafts:** drafts of at least three words appear in history;
  conversations with a sent message appear regardless of length.
- **Click-to-toggle dictation:** click to start, click to stop, then edit the
  transcript and press Send yourself. Dictation does not automatically send.
- **Image and text attachments:** PNG, JPEG, WebP, GIF, and common text/code
  formats, up to 10 MB per upload. Images require a vision-capable model.
  PDFs can be uploaded, but their contents are **not yet extracted**.
- **Separate chat instructions** editable in Settings, independent of the
  voice assistant's personality.

### Web search

- **Brave-powered search** in voice and chat when a Brave Search API key is set.
- **Page reading and phrase lookup** through `web_search`, `fetch_page`, and
  `find_in_page`, with source links in chat and a compact source popover in voice.
- **Per-conversation search toggle** in chat. Search and page retrieval require
  internet access.

### Models, speech, and personality

- **A built-in local model endpoint plus custom providers** with their own base
  URLs and API keys. Provider model lists load independently into a searchable
  picker, so one unavailable server does not block the others.
- **OpenAI-compatible transports**, including a Responses API fallback for
  supported provider errors. Compatibility still depends on the provider and model.
- **Local speech recognition** through transcribe.cpp. The catalogue includes
  Parakeet Unified EN, Parakeet TDT v3, Cohere Transcribe, Whisper Large v3 Turbo,
  and Canary; language coverage varies by model.
- **Kokoro speech synthesis** by default. Optional Chatterbox Turbo and Nano
  support expressive sound tags and cloned voices.
- **Voice cloning:** record, name, and delete voice clips in Settings, then use
  them with Chatterbox. A WAV in `models/tts/voices/` also becomes a named voice.
- **Download and switch speech models** from Settings, with download progress.
  Speech engines release weights after ten idle minutes and reload on use;
  the first request after that pause may take longer.
- **Custom personality:** use Rita's default sassy persona, choose plain, or
  write a custom brief. The selected model can generate or refine the brief.
- **Persistent settings:** model, voice, personality, drawing detail, providers,
  and chat instructions can be changed without editing source code.

### Diagnostics and integration

- **Optional debug bar:** resolved model/provider, request outcomes, STT/model/
  tool/TTS timing, events, raw messages, and state, with JSON copy for a turn.
- **OpenAI-compatible audio endpoints:** `POST /v1/audio/speech`,
  `POST /v1/audio/transcriptions`, and `GET /v1/models` through the backend.
- **Phone home-screen installation:** standalone app presentation with an icon.
  It still needs a connection to the SAWOT server.

## Screenshots

These are existing UI captures. Some predate the current mobile composer,
voice-picture controls, and dictation button; their placement may differ from
this checkout. The redesign gallery includes simulated device and model
responses, not proof of live device control. See the
[visual notes](screenshots/redesign/README.md) for capture context.

| Voice expression | Temperature readout on a phone |
| --- | --- |
| ![Ink forming a light bulb during a reply](screenshots/expression.png) | <img src="screenshots/readout-phone.png" alt="Numeric temperature drawn by the orb on a phone" width="280"> |

**Chat with reasoning and inline device controls**

![Chat conversation with expandable reasoning and light controls](screenshots/chat.png)

<details>
<summary>More screenshots: devices, speech settings, model picker, and diagnostics</summary>

**Devices** — cards for the entities involved in the conversation.

![Device cards with light and thermostat controls](screenshots/devices.png)

**Speech settings** — engine selection, voices, and voice cloning.

![Speech settings and voice cloning](screenshots/settings.png)

**Model picker on a phone** — searchable models grouped by provider.

<img src="screenshots/model-picker-phone.png" alt="Phone model picker with independent provider loading" width="350">

**Diagnostics** — a turn timeline and orb-expression details.

![Expanded debug bar with turn timeline](screenshots/debug.png)

</details>

## Before you install

You need:

- **Home Assistant**, its URL, and a long-lived access token from your Home
  Assistant profile's Security section. The current backend requires these
  even if you only intend to use general chat.
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

### 1. Get the project and configure credentials

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

1. Open **Settings → Connections** to enter your Home Assistant server URL and long-lived access token.
   Add custom model providers under **AI providers** using their OpenAI-compatible
   base URL and API key.
2. In **Settings → Assistant**, select a model with tool calling for voice/home
   tasks. Choose the personality and optional drawing detail. Chat also has its
   own model picker and instructions.
3. In **Settings → Speech**, download and select an STT model and a TTS model.
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
For a native installation, follow [requirements-chatterbox.txt](requirements-chatterbox.txt)
for the optional package commands and compatible PyTorch/torchaudio builds.
Then download and select **Chatterbox Turbo** or **Chatterbox Nano** in Speech
settings. Using it in Docker requires a custom image with those dependencies.

Record a short sample under **Cloned voices**, name it, and select it as the
voice. Cloned clips are used by Chatterbox, not Kokoro. Turbo and Nano can use
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

## Configuration reference

Start with [config.example.yaml](config.example.yaml) and [.env.example](.env.example).
Startup configuration changes require a restart; choices exposed in Settings
persist in `settings.json` and are applied at runtime.

| Purpose | YAML key | Environment variable |
| --- | --- | --- |
| Home Assistant connection | Settings → Connections (legacy: `home_assistant.url`) | `HA_URL` (migration only) |

| Built-in LLM server/model | `llm.url`, `llm.model` | `LLM_URL`, `LLM_MODEL` |
| Speech recognition | `stt.model`, `stt.language` | `STT_MODEL`, `STT_LANGUAGE` |
| Kokoro voice/language | `tts.voice`, `tts.lang_code` | `TTS_VOICE`, `TTS_LANG_CODE` |
| Name/personality | `assistant.name`, `assistant.personality` | `ASSISTANT_NAME`, `ASSISTANT_PERSONALITY` |
| Custom personality | `assistant.personality_prompt` | `ASSISTANT_PERSONALITY_PROMPT` |

| Bind address/port | `server.host`, `server.port` | `SERVER_HOST`, `SERVER_PORT` |
| Voice browser origins | `server.allowed_origins` (list) | `SAWOT_ALLOWED_ORIGINS` (comma-separated) |
| Direct HTTPS | `tls.certfile`, `tls.keyfile` | `TLS_CERTFILE`, `TLS_KEYFILE` |
| Runtime storage root | — | `SAWOT_DATA_DIR` |
| Backend → sidecar URL | — | `SAWOT_SIDECAR_URL` |
| Sidecar listening port | — | `SAWOT_SIDECAR_PORT` |

`controls` in YAML overrides the direct device-control service whitelist.
Home Assistant, Brave Search, Hugging Face, and AI providers are
managed in Settings → Connections and stored in `settings.json`. Credential fields show only
whether a key is configured; saved secrets are never sent back to the browser.
Blank replacement fields leave keys unchanged; **Remove** clears a saved key.
Home Assistant’s URL and token can be saved together. Chat’s Home Assistant
toggle is unavailable until both are configured, with a shortcut to setup.
The info button beside each connection explains what to enter and how to get it.

On upgrade, the backend imports the Home Assistant URL from `HA_URL` or
`home_assistant.url`, plus legacy `HA_TOKEN`, `BRAVE_API_KEY`, `HF_TOKEN`
(or `HUGGING_FACE_HUB_TOKEN`), and YAML `search.brave_api_key` values only when
the corresponding saved setting is absent. Saved values always win, including
explicit removals. After the first successful startup, remove the old credential
entries from `.env`, YAML, and deployment environment configuration. Compose
forwards optional legacy variables for migration; none are required for startup.
A cached `hf auth login` is used only if no Hugging Face setting exists; removing
a saved token disables that fallback too.
Both processes coordinate settings writes using `settings.json.lock`. If a crash
leaves that directory behind and saves report that settings are busy, stop SAWOT,
remove the stale lock directory, and start it again.
For Docker, explicitly forward additional environment variables in Compose;
its `.env` file is an interpolation source, not an automatic container env file.

## Data storage and privacy

For a standard native installation, these paths are under the repository root.
With `SAWOT_DATA_DIR`, they are under that directory instead. Docker sets it to
`/data`, mapped to the host's `./data`.

| Contents | Native path | Host path with the supplied Compose mount |
| --- | --- | --- |
| Chat conversations and saved drafts | `data/conversations/` | `data/data/conversations/` |
| Uploaded pictures and files | `data/uploads/` | `data/data/uploads/` |
| Voice reply/expression diagnostic log | `data/orb-replies.log` | `data/data/orb-replies.log` |
| Settings and provider credentials | `settings.json` | `data/settings.json` |
| Downloaded speech models | `models/` | `data/models/` |
| Cloned voice recordings | `models/tts/voices/` | `data/models/tts/voices/` |

Uploads persist across restarts. **Deleting a chat also deletes its associated
uploads**, including unsent files uploaded to that chat. Files referenced by another
chat are kept until that chat is deleted. Removing an attachment from the composer
keeps its file until the conversation is deleted. Older unattached uploads and
voice uploads have no automatic cleanup. Voice session history is distinct from saved chat conversations;
the diagnostic reply log can still contain voice response text.

Runtime data, credentials, and models are gitignored, but are not encrypted by
the app. Back them up and protect access to the host. Debug exports can contain
conversation content and device information.

When you select a hosted LLM, conversation content and attached images used in
requests leave the local server. Web search sends queries to Brave and fetches
external pages. Local speech processing does not make those features local.

## Known limitations

| Area | Current limitation |
| --- | --- |
| Access control | No authentication, separate users, or per-user conversation isolation. Trusted LAN only; a Home Assistant add-on with ingress is not included. |
| Hands-free voice | Explicitly started sessions only; no wake word or voice interruption during replies. Local sound-level detection uses a 1.4-second quiet interval and a 45-second turn limit; background sound or long thinking pauses can split turns. Noisy-room and real-device microphone behavior still need validation. |
| PDF support | Files are stored, but the TypeScript chat backend does not extract their text. Copy text into a supported text file instead. |
| Upload lifecycle | Chat deletion removes associated files. Unassociated legacy uploads and voice uploads have no automatic cleanup. Fresh installs must create the uploads directory; both setup paths above include this step. |
| Setup wizard | `scripts/setup.py` currently contains a Python syntax error. Use the manual setup steps above. |
| Model compatibility | Tool calling, image input, reasoning, and provider transports vary. The image-support hint uses model-name heuristics and can be wrong. |
| Memory/context | Chat sends the full saved message history; voice retains history for the current connection. Context metadata uses the local server's LM Studio native API when available (loaded context first, model maximum otherwise), with a 128,000-token fallback. The provider enforces its actual limit; context overflow displays an error. There is no automatic trimming or summarization. Text attachments are capped at 50,000 characters. |
| Web retrieval | Page downloads and extracted text are bounded; login-only pages, JavaScript-heavy pages, and unavailable sites may not yield useful content. |
| Speech performance | Speed, RAM/VRAM use, and language quality depend on the selected engines and hardware. Idle reloads add latency; optional Chatterbox requires extra dependencies. |
| Platforms | The published Docker image is CPU-only and `linux/amd64`; there is no native ARM image for Raspberry Pi or Apple Silicon. |
| Visual output | Freehand sketches depend on the model. An action shape indicates an attempted action, not confirmation that a device changed. |
| Frontend development | The current Vite config proxies `/ws` only. Full chat/settings development also needs `/api` and relevant audio routes proxied to the backend. The built UI served on port 8765 avoids this issue. |

## Development and verification

| Directory | Responsibility |
| --- | --- |
| `web/` | React, TypeScript, Vite, Zustand, Three.js ink renderer |
| `ts-backend/` | Fastify, voice WebSocket pipeline, streaming chat, providers, Home Assistant and search tools |
| `sidecar/` | Python FastAPI speech service |
| `server/` | Speech engines, model downloads, voice clips, configuration and audio API |
| `tests/`, `ts-backend/tests/`, `web/tests/` | Python and TypeScript regression tests |

From the repository root, after installing dependencies:

```bash
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/pytest -q
(cd ts-backend && npm run typecheck && npm run build)
(cd web && npm run typecheck && npm run build)
(cd ts-backend && node --import tsx --test tests/*.test.ts ../web/tests/*.test.ts)
```

Use `npm run dev` in `web/` for frontend hot reload and in `ts-backend/` for
backend watch mode. The backend still needs the Python sidecar; run
`./run_sidecar.sh` separately. Add the actual Vite origin (normally
`http://localhost:5173`) to the voice allowlist and account for the proxy
limitation above. Avoid starting a second backend on an occupied port.

CI commands are in [.github/workflows/ci.yml](.github/workflows/ci.yml).
Mocked tests and screenshot fixtures do not verify real microphones, speech
quality, provider compatibility, or live Home Assistant actions.

For extensions, start with `ts-backend/src/tools.ts` (tools),
`ts-backend/src/expressions.ts` and `web/src/lib/inkShapes.ts` (orb expressions),
`ts-backend/src/providers.ts` (providers), or `server/stt.py` and `server/tts.py`
(speech engines). Contribution and commit conventions are in
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © 2026 Ed Masoud
