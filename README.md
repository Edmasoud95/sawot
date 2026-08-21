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

## Architecture

- `server/` — FastAPI backend: WebSocket voice pipeline, REST chat/settings
  APIs, Home Assistant client, LLM agent + tools, faster-whisper STT, Kokoro TTS.
- `web/` — React + Vite frontend, built into `web/dist/` and served statically.
- `config.yaml` + `.env` — runtime configuration and the HA token.

## Prerequisites

- NVIDIA GPU visible in WSL2 (`nvidia-smi`) — STT uses CUDA by default;
  CPU-only works if you set `stt.device: "cpu"`.
- `sudo apt install espeak-ng ffmpeg`
- Node.js 20+ and npm (to build the frontend)
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
(cd web && npm install && npm run build)   # build the UI into web/dist
```

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
| `tts.voice` | Kokoro voice (see the Settings panel for the list) |
| `server.host` / `server.port` | Bind address / port (default `0.0.0.0:8765`) |
| `tls.certfile` / `tls.keyfile` | Optional — required for phone mic access over https |

Put your Home Assistant token in `.env` as `HA_TOKEN=...`.

## Run

```bash
./run.sh
```

(`run.sh` sets `LD_LIBRARY_PATH` to the venv's CUDA 12 cuBLAS/cuDNN before
starting the server — faster-whisper's CTranslate2 needs them, and the copies
torch ships are CUDA 13.)

Open <http://localhost:8765>, or `http://<machine-ip>:8765` from another
device on your LAN.

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
.venv/bin/pytest
```

End-to-end with real models: `.venv/bin/python scripts/smoke.py sample.wav`

Prompt/tool-choice eval (live LM Studio, dry-run HA — never touches devices):
`.venv/bin/python scripts/eval.py`

## Development

Frontend hot reload: `cd web && npm run dev` (proxies `/ws` to the server on 8765).

## License

[MIT](LICENSE) © 2026 Ed Masoud
