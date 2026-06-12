import textwrap

import pytest

import server.config as config_mod
from server.config import load_config


def test_load_config(tmp_path, monkeypatch):
    cfg_file = tmp_path / "config.yaml"
    cfg_file.write_text(textwrap.dedent("""
        home_assistant:
          url: "http://ha.local:8123/"
        lm_studio:
          url: "http://localhost:1234/v1"
          model: "qwen3-8b"
        stt:
          model: "distil-small.en"
          device: "cpu"
        tts:
          voice: "af_heart"
        server:
          host: "127.0.0.1"
          port: 9999
    """))
    monkeypatch.setenv("HA_TOKEN", "secret-token")

    cfg = load_config(str(cfg_file))

    assert cfg.ha_url == "http://ha.local:8123"  # trailing slash stripped
    assert cfg.ha_token == "secret-token"
    assert cfg.lmstudio_url == "http://localhost:1234/v1"
    assert cfg.lmstudio_model == "qwen3-8b"
    assert cfg.stt_model == "distil-small.en"
    assert cfg.stt_device == "cpu"
    assert cfg.tts_voice == "af_heart"
    assert cfg.host == "127.0.0.1"
    assert cfg.port == 9999


def test_load_config_missing_token_raises(tmp_path, monkeypatch):
    cfg_file = tmp_path / "config.yaml"
    cfg_file.write_text(textwrap.dedent("""
        home_assistant:
          url: "http://ha.local:8123/"
        lm_studio:
          url: "http://localhost:1234/v1"
          model: "qwen3-8b"
        stt:
          model: "distil-small.en"
        tts:
          voice: "af_heart"
        server: {}
    """))
    # load_dotenv() resolves the repo's real .env regardless of cwd, so stub
    # it out — this test verifies the guard, not dotenv discovery.
    monkeypatch.setattr(config_mod, "load_dotenv", lambda: None)
    monkeypatch.delenv("HA_TOKEN", raising=False)
    with pytest.raises(RuntimeError, match="HA_TOKEN"):
        load_config(str(cfg_file))


def test_load_config_parses_optional_tls(tmp_path, monkeypatch):
    cfg_file = tmp_path / "config.yaml"
    cfg_file.write_text(textwrap.dedent("""
        home_assistant:
          url: "http://ha.local:8123"
        lm_studio:
          url: "http://localhost:1234/v1"
          model: "m"
        stt:
          model: "distil-small.en"
        tts:
          voice: "af_heart"
        server: {}
        tls:
          certfile: "certs/voice.crt"
          keyfile: "certs/voice.key"
    """))
    monkeypatch.setenv("HA_TOKEN", "t")
    cfg = load_config(str(cfg_file))
    assert cfg.ssl_certfile == "certs/voice.crt"
    assert cfg.ssl_keyfile == "certs/voice.key"


def test_load_config_tls_defaults_to_none(tmp_path, monkeypatch):
    cfg_file = tmp_path / "config.yaml"
    cfg_file.write_text(textwrap.dedent("""
        home_assistant:
          url: "http://ha.local:8123"
        lm_studio:
          url: "http://localhost:1234/v1"
          model: "m"
        stt:
          model: "distil-small.en"
        tts:
          voice: "af_heart"
        server: {}
    """))
    monkeypatch.setenv("HA_TOKEN", "t")
    cfg = load_config(str(cfg_file))
    assert cfg.ssl_certfile is None
    assert cfg.ssl_keyfile is None
