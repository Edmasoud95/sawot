from server.settings import KOKORO_VOICES, SettingsStore


def test_kokoro_voices_present():
    assert "af_heart" in KOKORO_VOICES
    assert "af_alloy" in KOKORO_VOICES
    assert len(KOKORO_VOICES) == 13


def test_store_roundtrip(tmp_path):
    store = SettingsStore(str(tmp_path / "s.json"))
    assert store.load() == {}
    store.save({"model": "m"})
    assert store.load() == {"model": "m"}


def test_store_load_survives_corrupt_file(tmp_path):
    p = tmp_path / "s.json"
    p.write_text("{truncated")
    assert SettingsStore(str(p)).load() == {}
