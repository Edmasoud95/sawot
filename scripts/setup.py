#!/usr/bin/env python
"""SAWOT setup wizard: configure and download models.

Walks through configuration (Home Assistant, model server) and downloads the
speech-to-text and text-to-speech models, then writes config.yaml and .env.

Usage:
    .venv/bin/python scripts/setup.py
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from server.models import MODELS_DIR, STT_MODELS, TTS_MODELS, download, is_downloaded  # noqa: E402


def ask(prompt, default=None):
    suffix = f" [{default}]" if default is not None else ""
    while True:
        val = input(f"{prompt}{suffix}: ").strip()
        if not val and default is not None:
            return default
        if val:
            return val


def ask_yesno(prompt, default=True):
    return ask(f"{prompt} (y/n)", "y" if default else "n").lower().startswith("y")


def choose(prompt, options, default_id):
    print(f"
{prompt}")
    for i, opt in enumerate(options, 1):
        tag = "  (recommended)" if opt.recommended else ""
        print(f"  {i}. {opt.label}  ~{opt.size_mb} MB{tag}")
        print(f"     {opt.description}")
    default_idx = next(i for i, o in enumerate(options, 1) if o.id == default_id)
    while True:
        choice = ask("Choose a number", str(default_idx))
        try:
            idx = int(choice)
            if 1 <= idx <= len(options):
                return options[idx - 1]
        except ValueError:
            pass
        print("  invalid choice")


def download_model(spec):
    print(f"
Downloading {spec.label} (~{spec.size_mb} MB)...")
    try:
        download(spec)  # tqdm_class=None => real progress bar
        print(f"OK: {spec.label}")
        return True
    except Exception as exc:
        print(f"FAILED: {spec.label}: {exc}")
        return False


def write_config(cfg):
    yaml_text = f"""home_assistant:
  url: "{cfg['ha_url'].rstrip('/')}"
llm:
  url: "{cfg['lm_url'].rstrip('/')}"
  model: "{cfg['lm_model']}"
stt:
  model: "{cfg['stt'].id}"
  language: "en"
tts:
  voice: "{cfg['voice']}"
  lang_code: "a"
assistant:
  name: "Rita"
  personality: "sassy"
server:
  host: "0.0.0.0"
  port: 8765
"""
    (ROOT / "config.yaml").write_text(yaml_text)
    (ROOT / ".env").write_text(f"HA_TOKEN={cfg['ha_token']}
")
    print("\nWrote config.yaml and .env")
    print("Models will be stored in", MODELS_DIR)


def main():
    print("=" * 60)
    print("SAWOT setup")
    print("=" * 60)

    stt = choose("Speech-to-text model:", STT_MODELS, "cohere-transcribe")
    tts = next(m for m in TTS_MODELS if m.recommended)  # Kokoro; Chatterbox downloads from Settings

    voice = ask("Kokoro voice", "af_heart")

    print("\n--- Configuration ---")
    ha_url = ask("Home Assistant URL", "http://192.168.1.10:8123")
    ha_token = ask("Home Assistant long-lived access token")
    lm_url = ask("Model server URL (any OpenAI-compatible /v1 endpoint)", "http://192.168.1.11:1234/v1")
    lm_model = ask("Model name", "gemma-4")

    print("\n--- Models ---")
    ok_stt = is_downloaded(stt) or download_model(stt)
    ok_tts = is_downloaded(tts)
    if not ok_tts and ask_yesno("Download Kokoro TTS model?"):
        ok_tts = download_model(tts)

    write_config(dict(
        ha_url=ha_url, ha_token=ha_token, lm_url=lm_url, lm_model=lm_model,
        stt=stt, voice=voice,
    ))

    print("\nSetup complete. Start the server with ./run.sh")
    print(f"STT: {'downloaded' if ok_stt else 'NOT downloaded (use Settings to download)'}")
    print(f"TTS: {'downloaded' if ok_tts else 'NOT downloaded (use Settings to download)'}")


if __name__ == "__main__":
    main()
