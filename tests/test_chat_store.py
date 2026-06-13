from server.chat import ChatStore


def make_store(tmp_path):
    return ChatStore(root=str(tmp_path / "convs"))


def test_create_get_roundtrip(tmp_path):
    store = make_store(tmp_path)
    conv = store.create(model="m1")
    assert conv["title"] == "New chat"
    assert conv["model"] == "m1"
    assert conv["messages"] == []
    assert conv["created"] > 0
    got = store.get(conv["id"])
    assert got == conv


def test_list_newest_updated_first(tmp_path):
    store = make_store(tmp_path)
    a = store.create(model="m")
    b = store.create(model="m")
    a["updated"] = a["updated"] + 100
    store.save(a)
    ids = [c["id"] for c in store.list()]
    assert ids == [a["id"], b["id"]]
    # summaries do not include messages
    assert "messages" not in store.list()[0]


def test_save_updates_and_delete(tmp_path):
    store = make_store(tmp_path)
    conv = store.create(model="m")
    conv["title"] = "Lights"
    conv["messages"].append({"role": "user", "content": "hi"})
    store.save(conv)
    assert store.get(conv["id"])["title"] == "Lights"
    store.delete(conv["id"])
    assert store.get(conv["id"]) is None


def test_corrupt_file_skipped(tmp_path):
    store = make_store(tmp_path)
    ok = store.create(model="m")
    (tmp_path / "convs" / "broken.json").write_text("{nope")
    assert [c["id"] for c in store.list()] == [ok["id"]]
    assert store.get("broken") is None


def test_get_unknown_returns_none(tmp_path):
    assert make_store(tmp_path).get("nope") is None
