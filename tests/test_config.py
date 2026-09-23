import textwrap

import pytest

import server.config as config_mod
from server.config import load_config


def test_load_config(tmp_path, monkeypatch):
    cfg_file = tmp_path / "config.yaml"
    cfg_file.write_text(textwrap.dedent("""
        home_assistant:
          url: "http://ha.local:8123/"
        llm:
          url: "http://localhost:1234/v1/"
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
    assert cfg.llm_url == "http://localhost:1234/v1"  # trailing slash stripped
    assert cfg.llm_model == "qwen3-8b"
    assert cfg.stt_model == "distil-small.en"
    assert cfg.tts_voice == "af_heart"
    assert cfg.host == "127.0.0.1"
    assert cfg.port == 9999


def test_load_config_without_token_permits_settings_setup(tmp_path, monkeypatch):
    cfg_file = tmp_path / "config.yaml"
    cfg_file.write_text(textwrap.dedent("""
        home_assistant:
          url: "http://ha.local:8123/"
        llm:
          url: "http://localhost:1234/v1"
          model: "qwen3-8b"
        stt:
          model: "distil-small.en"
        tts:
          voice: "af_heart"
        server: {}
    """))
    monkeypatch.delenv("HA_TOKEN", raising=False)
    assert load_config(str(cfg_file)).ha_token == ""


def test_load_config_parses_optional_tls(tmp_path, monkeypatch):
    cfg_file = tmp_path / "config.yaml"
    cfg_file.write_text(textwrap.dedent("""
        home_assistant:
          url: "http://ha.local:8123"
        llm:
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


def test_load_config_accepts_dict_source_and_assistant(monkeypatch):
    monkeypatch.setenv("HA_TOKEN", "t")
    cfg = load_config({
        "home_assistant": {"url": "http://ha.local:8123"},
        "llm": {"url": "http://localhost:1234/v1", "model": "m"},
        "stt": {"model": "distil-small.en", "device": "cpu", "language": "de"},
        "tts": {"voice": "af_heart", "lang_code": "a"},
        "assistant": {"name": "Jarvis", "personality": "plain"},
        "controls": {"light": ["turn_on"]},
        "server": {},
    })
    assert cfg.stt_language == "de"
    assert cfg.tts_lang_code == "a"
    assert cfg.assistant_name == "Jarvis"
    assert cfg.assistant_sassy is False
    assert cfg.allowed_controls == {"light": ["turn_on"]}


def test_load_config_defaults_assistant_and_language(tmp_path, monkeypatch):
    cfg_file = tmp_path / "config.yaml"
    cfg_file.write_text(textwrap.dedent("""
        home_assistant:
          url: "http://ha.local:8123"
        llm:
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
    assert cfg.assistant_name == "Rita"
    assert cfg.assistant_sassy is True
    assert cfg.stt_language == "en"
    assert cfg.tts_lang_code == "a"
    assert cfg.allowed_controls is None


def test_load_config_tls_defaults_to_none(tmp_path, monkeypatch):
    cfg_file = tmp_path / "config.yaml"
    cfg_file.write_text(textwrap.dedent("""
        home_assistant:
          url: "http://ha.local:8123"
        llm:
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


def test_load_config_from_environment_only(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)  # no config.yaml here
    monkeypatch.setenv("HA_URL", "http://ha.local:8123/")
    monkeypatch.setenv("HA_TOKEN", "t")
    monkeypatch.setenv("LLM_URL", "http://host.docker.internal:1234/v1/")
    monkeypatch.setenv("LLM_MODEL", "qwen3-8b")
    monkeypatch.setenv("STT_LANGUAGE", "de")
    monkeypatch.setenv("ASSISTANT_PERSONALITY", "plain")
    monkeypatch.setenv("SERVER_PORT", "9000")

    cfg = load_config()

    assert cfg.ha_url == "http://ha.local:8123"
    assert cfg.llm_url == "http://host.docker.internal:1234/v1"
    assert cfg.llm_model == "qwen3-8b"
    assert cfg.stt_language == "de"
    assert cfg.assistant_sassy is False
    assert cfg.port == 9000
    # Defaults for everything not given
    assert cfg.stt_model == "parakeet-unified-en"
    assert cfg.tts_voice == "af_heart"
    assert cfg.host == "0.0.0.0"
    assert cfg.assistant_name == "Rita"


def test_environment_overrides_yaml(tmp_path, monkeypatch):
    cfg_file = tmp_path / "config.yaml"
    cfg_file.write_text(textwrap.dedent("""
        home_assistant:
          url: "http://yaml.local:8123"
        llm:
          url: "http://localhost:1234/v1"
          model: "from-yaml"
        stt:
          model: "distil-small.en"
        tts:
          voice: "af_heart"
        server: {}
    """))
    monkeypatch.setenv("HA_TOKEN", "t")
    monkeypatch.setenv("HA_URL", "http://env.local:8123")
    monkeypatch.delenv("LLM_MODEL", raising=False)

    cfg = load_config(str(cfg_file))

    assert cfg.ha_url == "http://env.local:8123"
    assert cfg.llm_model == "from-yaml"


def test_load_config_missing_ha_url_permits_setup(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("HA_TOKEN", "t")
    monkeypatch.delenv("HA_URL", raising=False)
    assert load_config().ha_url == ""


def test_saved_token_wins_over_environment_and_can_be_removed(tmp_path):
    cfg_file = tmp_path / "config.yaml"
    cfg_file.write_text("home_assistant:\n  url: http://ha.local\n")
    settings = tmp_path / "settings.json"
    settings.write_text('{"haToken": "saved-fixture"}')
    assert load_config(cfg_file, env={"HA_TOKEN": "old"}).ha_token == "saved-fixture"
    settings.write_text('{"haToken": ""}')
    assert load_config(cfg_file, env={"HA_TOKEN": "old"}).ha_token == ""


def test_saved_token_uses_data_directory(tmp_path):
    (tmp_path / "settings.json").write_text('{"haToken": "volume-fixture"}')
    cfg = load_config({"home_assistant": {"url": "http://ha.local"}},
                      env={"SAWOT_DATA_DIR": str(tmp_path)})
    assert cfg.ha_token == "volume-fixture"


def test_saved_ha_url_wins_over_environment(tmp_path):
    (tmp_path / "settings.json").write_text('{"haUrl": "https://saved.invalid/ha"}')
    config = tmp_path / "config.yaml"
    cfg = load_config(config, env={"HA_URL": "http://legacy.invalid"})
    assert cfg.ha_url == "https://saved.invalid/ha"
    (tmp_path / "settings.json").write_text('{"haUrl": ""}')
    assert load_config(config, env={"HA_URL": "http://legacy.invalid"}).ha_url == ""
