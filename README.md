# HomeAssistantVoice

Fully local voice assistant for Home Assistant: push-to-talk in the browser,
faster-whisper STT, LM Studio LLM with tool calling, Kokoro TTS.

## Prerequisites

- NVIDIA GPU visible in WSL2 (`nvidia-smi`)
- `sudo apt install espeak-ng ffmpeg`
- Node.js 20+ and npm (frontend build)
- LM Studio running on the Windows host with a tool-calling model loaded
  (recommended: Qwen3-8B Q4) and the local server enabled
- Home Assistant long-lived access token
  (HA → Profile → Security → Long-lived access tokens)

## Setup

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env        # paste your HA token
# edit config.yaml: HA URL, LM Studio URL (Windows host IP), model name
(cd web && npm install && npm run build)   # build the UI into web/dist
```

Find the Windows host IP from WSL2: `ip route show | grep default`.

## Run

```bash
./run.sh
```

(The script sets `LD_LIBRARY_PATH` to the venv's CUDA 12 cuBLAS/cuDNN before
starting `server.main` — faster-whisper's CTranslate2 needs them, and the
copies torch ships are CUDA 13. They're installed with
`pip install nvidia-cublas-cu12 "nvidia-cudnn-cu12>=9,<10"`.)

Open http://localhost:8765 (or http://<machine-ip>:8765 from your phone —
note the mic requires HTTPS off-localhost; for phone testing use
`chrome://flags/#unsafely-treat-insecure-origin-as-secure` or an HTTPS proxy).

Hold the button, speak, release. With TLS configured (`tls:` in config.yaml,
self-signed cert in `certs/`), use https:// — required for phone microphone
access (accept the certificate warning once per device).

## UI features

- **Settings** (gear, top-left): switch the LLM model (live list from
  LM Studio) and Kokoro voice; applies instantly, persists to `settings.json`.
- **Advanced mode** (grid icon, top-right): replaces the orb with control
  cards for the devices each answer touched — toggle lights/switches, set
  brightness and target temperature directly.
- **History drawer** (dots, top-right): conversation log; the **debug**
  toggle shows a per-turn pipeline trace (STT/LLM/tool/TTS timings and
  arguments) for diagnosing wrong answers.

## Tests

```bash
.venv/bin/pytest
```

End-to-end with real models: `.venv/bin/python scripts/smoke.py sample.wav`

Prompt/tool-choice eval (live LM Studio, dry-run HA — never touches devices):
`.venv/bin/python scripts/eval.py`

## Development

Frontend hot reload: `cd web && npm run dev` (proxies /ws to the server on 8765).
