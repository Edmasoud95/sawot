from server.chat import ThinkTagParser


def feed_all(chunks):
    p = ThinkTagParser()
    out = []
    for c in chunks:
        out.extend(p.feed(c))
    out.extend(p.flush())
    # merge adjacent same-kind pieces for stable assertions
    merged = []
    for kind, text in out:
        if merged and merged[-1][0] == kind:
            merged[-1] = (kind, merged[-1][1] + text)
        else:
            merged.append((kind, text))
    return merged


def test_plain_text():
    assert feed_all(["hello ", "world"]) == [("content", "hello world")]


def test_single_think_block():
    assert feed_all(["<think>hmm</think>answer"]) == [
        ("thinking", "hmm"),
        ("content", "answer"),
    ]


def test_tag_split_across_every_boundary():
    s = "<think>deep thought</think>final"
    for i in range(1, len(s)):
        assert feed_all([s[:i], s[i:]]) == [
            ("thinking", "deep thought"),
            ("content", "final"),
        ], f"split at {i}"


def test_unclosed_think_flushes_as_thinking():
    assert feed_all(["<think>still going"]) == [("thinking", "still going")]


def test_text_before_think():
    assert feed_all(["a<think>b</think>c"]) == [
        ("content", "a"),
        ("thinking", "b"),
        ("content", "c"),
    ]


def test_angle_bracket_content_not_eaten():
    assert feed_all(["x < y and <thinker> tag"]) == [
        ("content", "x < y and <thinker> tag")
    ]
