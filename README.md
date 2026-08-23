# SAWOT

Fully local voice and chat assistant for Home Assistant: push-to-talk in the
browser, [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
speech-to-text, an LM Studio LLM with Home Assistant tool calling, and
[Kokoro](https://github.com/hexgrad/kokoro) text-to-speech — no cloud required.

> **Security note:** this server has **no authentication** and can control
> your devices over the network. Run it only on a trusted LAN, or bind
> `server.host` to `127.0.0.1`. See [SECURITY.md](SECURITY.md).

## Features

- **Voice assistant** — hold the button, speak, release. Local STT → LLM →
  TTS pipeline with live per-turn latency traces.
- **Home Assistant control** — the model uses tools (`get_entities`,
  `call_service`) to list and control your devices, then shows interactive
  control cards for anything it touched.
- **Advanced mode** — toggle lights and switches, set brightness and target
  temperature directly from the cards.
- **Chat** — a ChatGPT-style interface with multiple server-stored
  conversations, streaming replies, collapsible reasoning, and the same
  Home Assistant tools.
- **Attachments** — upload images (vision models), text files, and PDFs
  (extracted text is sent inline to the model).
- **Personality** — "Rita" ships with a sassy, teasing persona that you can
  switch off from Settings for a plain, friendly assistant.
- **Live settings** — switch the LLM model and Kokoro voice at runtime;
  choices apply instantly and persist to `settings.json`.
- **OpenAI-compatible audio API** — `POST /v1/audio/speech` (TTS) and
  `POST /v1/audio/transcriptions` (STT) let any OpenAI SDK client use the
  local engines as a drop-in speech backend.

## Screenshots

**Voice mode** — hold the button, speak, release:

![Voice mode](screenshots/voice.png)

**Chat mode** — text chat with tools and attachments:

![Chat mode](screenshots/chat.png)

**Settings** — model, voice, and personality:

![Settings panel](screenshots/settings.png)

## Architecture

- `ts-backend/` — TypeScript (Fastify) backend: WebSocket voice pipeline, chat
  (SSE), settings, Home Assistant client, and the LLM agent + tools. Proxies
  STT/TTS to the Python sidecar.
- `sidecar/` + `server/` — Python (FastAPI) inference sidecar: faster-whisper
  STT, Kokoro TTS, and the model download manager.
- `web/` — TypeScript (React + Vite) frontend, built into `web/dist/`.
- `config.yaml` + `.env` — runtime configuration and the HA token.

## Prerequisites

- NVIDIA GPU visible in WSL2 (`nvidia-smi`) — STT uses CUDA by default;
  CPU-only works if you set `stt.device: "cpu"`.
- `sudo apt install espeak-ng ffmpeg`
- Node.js 20+ and npm (TypeScript backend + frontend)
- [LM Studio](https://lmstudio.ai/) running with a tool-calling model loaded
  (recommended: Qwen3-8B Q4) and its local server enabled
- A Home Assistant
  [long-lived access token](https://www.home-assistant.io/docs/authentication/#your-account-profile)
  (HA → Profile → Security → Long-lived access tokens)

## Setup

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp config.example.yaml config.yaml   # HA URL, LM Studio URL, model name
cp .env.example .env                 # paste your HA token
(cd ts-backend && npm install && npm run build)   # TypeScript backend
(cd web && npm install && npm run build)          # UI into web/dist
```

> **Tip — setup wizard:** `.venv/bin/python scripts/setup.py` walks through
> configuration and downloads the STT + TTS models in one go.

If LM Studio runs on the Windows host under WSL2, find its IP with
`ip route show | grep default`.

## Configuration

Edit `config.yaml`:

| Key | Description |
| --- | --- |
| `home_assistant.url` | Your Home Assistant URL |
| `lm_studio.url` | LM Studio server URL (LAN IP of the host) |
| `lm_studio.model` | The tool-calling model loaded in LM Studio |
| `stt.model` | faster-whisper model size (e.g. `distil-small.en`) |
| `stt.device` | `cuda` (default) or `cpu` |
| `stt.language` | Transcription language (default `en`) |
| `tts.voice` | Kokoro voice (see the Settings panel for the list) |
| `tts.lang_code` | Kokoro language code (default `a` = American English) |
| `assistant.name` | Assistant name in the system prompt (default `Rita`) |
| `assistant.personality` | `sassy` (default) or `plain` |
| `server.host` / `server.port` | Bind address / port (default `0.0.0.0:8765`) |
| `controls` | Optional per-domain service whitelist override |
| `tls.certfile` / `tls.keyfile` | Optional — required for phone mic access over https |

Put your Home Assistant token in `.env` as `HA_TOKEN=...`.

## Models

Speech-to-text and text-to-speech models are downloaded on demand into a local
`models/` directory (gitignored). Two ways to fetch them:

- **Settings** → a download button next to each STT/TTS model, with a progress
  bar. The recommended model for each kind is flagged.
- **Setup wizard** → `.venv/bin/python scripts/setup.py`.

Recommended defaults: `distil-small.en` (STT) and Kokoro-82M (TTS). Once
downloaded, the server runs fully offline.

## Run

```bash
./run.sh
```

`run.sh` starts the Python inference sidecar (STT/TTS) and the TypeScript
backend, building `ts-backend/dist` and `web/dist` first if they're missing.

Open <http://localhost:8765>, or `http://<machine-ip>:8765` from another device
on your LAN (use `https://` when TLS is configured).

## Usage

### Voice

Hold the button, speak, release. With TLS configured (self-signed cert in
`certs/`), use `https://` — required for phone microphone access (accept the
certificate warning once per device).

### Settings (gear, top-left)

Switch the LLM model (live list from LM Studio), the Kokoro voice, and the
sassy personality — applied instantly and persisted.

### Advanced mode (grid, top-right)

Replaces the orb with control cards for the devices each answer touched —
toggle lights/switches, set brightness and target temperature.

### History & debug (dots, top-right)

Conversation log; the **debug** toggle shows a per-turn pipeline trace
(STT/LLM/tool/TTS timings and arguments).

### Chat (third position on the mode switch)

Text chat with multiple server-stored conversations (`data/conversations/`),
streaming replies with collapsible thinking, a per-conversation model picker,
image/text/PDF uploads, the same Home Assistant tools, and inline device cards.

## Tests

```bash
.venv/bin/pytest                     # Python sidecar (STT/TTS/models)
(cd ts-backend && npm run typecheck) # TypeScript backend
(cd web && npm run typecheck)        # frontend
```

## Development

Frontend hot reload: `cd web && npm run dev` (proxies `/ws` to the backend).
Backend dev: `cd ts-backend && npm run dev` (needs the sidecar running — see
`./run_sidecar.sh`).

## Extending

- **Tools** — the LLM agent consumes a list of `Tool` objects
  (`ts-backend/src/tools.ts`); Home Assistant tools are one provided set
  (`buildHaTools`). Add a `Tool` and pass it to `Agent` to teach the assistant
  new skills.
- **Engines** — the Python sidecar exposes STT/TTS over HTTP
  (`server/stt.py`, `server/tts.py`); swap them for any backend without touching
  the TypeScript code.
- **Voice pipeline** — `ts-backend/src/pipeline.ts` exposes the STT → agent →
  TTS turn independent of the WebSocket transport.
- **OpenAI API** — the sidecar registers `/v1/audio/speech`,
  `/v1/audio/transcriptions`, and `/v1/models`; the TypeScript backend proxies
  them at the same paths.

## License

[MIT](LICENSE) © 2026 Ed Masoud
