import json
import time
import uuid
from pathlib import Path

from server.llm import TOOLS, _touched_ids, execute_tool

MAX_ROUNDS = 5

_PROJECT_ROOT = Path(__file__).resolve().parent.parent


class ChatStore:
    """One JSON file per conversation under data/conversations/."""

    def __init__(self, root: str | None = None):
        self._root = Path(root) if root else _PROJECT_ROOT / "data" / "conversations"
        self._root.mkdir(parents=True, exist_ok=True)

    def _path(self, cid: str) -> Path:
        return self._root / f"{cid}.json"

    def create(self, model: str) -> dict:
        now = time.time()
        conv = {
            "id": uuid.uuid4().hex[:12],
            "title": "New chat",
            "model": model,
            "created": now,
            "updated": now,
            "messages": [],
        }
        self.save(conv)
        return conv

    def get(self, cid: str) -> dict | None:
        path = self._path(cid)
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            return None

    def save(self, conv: dict) -> None:
        self._path(conv["id"]).write_text(json.dumps(conv, indent=2))

    def delete(self, cid: str) -> None:
        self._path(cid).unlink(missing_ok=True)

    def list(self) -> list[dict]:
        out = []
        for path in self._root.glob("*.json"):
            try:
                conv = json.loads(path.read_text())
            except (json.JSONDecodeError, OSError):
                continue
            out.append({k: conv[k] for k in ("id", "title", "model", "created", "updated")})
        return sorted(out, key=lambda c: c["updated"], reverse=True)


class ThinkTagParser:
    """Splits streamed text into ('thinking'|'content', text) pieces,
    tolerating <think>/</think> tags split across chunks: a suffix that
    could begin the next expected tag is held back until disambiguated."""

    OPEN, CLOSE = "<think>", "</think>"

    def __init__(self):
        self._in_think = False
        self._buf = ""

    def feed(self, text: str) -> list[tuple[str, str]]:
        self._buf += text
        out: list[tuple[str, str]] = []
        kind = lambda: "thinking" if self._in_think else "content"
        while self._buf:
            tag = self.CLOSE if self._in_think else self.OPEN
            idx = self._buf.find(tag)
            if idx != -1:
                if idx:
                    out.append((kind(), self._buf[:idx]))
                self._buf = self._buf[idx + len(tag):]
                self._in_think = not self._in_think
                continue
            keep = 0
            for k in range(min(len(tag) - 1, len(self._buf)), 0, -1):
                if tag.startswith(self._buf[-k:]):
                    keep = k
                    break
            emit_len = len(self._buf) - keep
            if emit_len:
                out.append((kind(), self._buf[:emit_len]))
                self._buf = self._buf[emit_len:]
            break
        return out

    def flush(self) -> list[tuple[str, str]]:
        out = []
        if self._buf:
            out.append(("thinking" if self._in_think else "content", self._buf))
            self._buf = ""
        return out


async def run_chat(client, model, ha, system_prompt, messages):
    """Streaming chat agent. Yields ("thinking"|"content", str),
    ("tool", dict), ("entities", list), and exactly one ("final", dict)."""
    convo = [{"role": "system", "content": system_prompt}, *messages]
    touched: list[str] = []
    finished = False
    for _ in range(MAX_ROUNDS):
        parser = ThinkTagParser()
        content_parts: list[str] = []
        thinking_parts: list[str] = []
        tool_calls: dict[int, dict] = {}
        stream = await client.chat.completions.create(
            model=model, messages=convo, tools=TOOLS, stream=True
        )
        async for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            reasoning = getattr(delta, "reasoning_content", None)
            if reasoning:
                thinking_parts.append(reasoning)
                yield ("thinking", reasoning)
            if delta.content:
                for kind, text in parser.feed(delta.content):
                    if kind == "content":
                        content_parts.append(text)
                    else:
                        thinking_parts.append(text)
                    yield (kind, text)
            for tc in delta.tool_calls or []:
                slot = tool_calls.setdefault(
                    tc.index, {"id": "", "name": "", "arguments": ""}
                )
                if tc.id:
                    slot["id"] = tc.id
                if tc.function and tc.function.name:
                    slot["name"] = tc.function.name
                if tc.function and tc.function.arguments:
                    slot["arguments"] += tc.function.arguments
        for kind, text in parser.flush():
            (content_parts if kind == "content" else thinking_parts).append(text)
            yield (kind, text)
        content = "".join(content_parts)
        if not tool_calls:
            yield ("final", {"content": content.strip(),
                             "thinking": "".join(thinking_parts).strip()})
            finished = True
            break
        calls = [tool_calls[i] for i in sorted(tool_calls)]
        convo.append({
            "role": "assistant",
            "content": content or None,
            "tool_calls": [
                {"id": c["id"], "type": "function",
                 "function": {"name": c["name"], "arguments": c["arguments"]}}
                for c in calls
            ],
        })
        for c in calls:
            try:
                args = json.loads(c["arguments"] or "{}")
            except json.JSONDecodeError as exc:
                args = {}
                result = {"error": f"invalid tool arguments: {exc}"}
            else:
                result = await execute_tool(ha, c["name"], args)
            result_json = json.dumps(result)
            yield ("tool", {"name": c["name"], "args": args,
                            "result": result_json[:300]})
            for eid in _touched_ids(c["name"], args, result):
                if eid not in touched:
                    touched.append(eid)
            convo.append({"role": "tool", "tool_call_id": c["id"],
                          "content": result_json})
    if not finished:
        yield ("final", {"content": "Sorry, I couldn't complete that.",
                         "thinking": ""})
    if touched:
        try:
            yield ("entities", await ha.get_cards(touched[:8]))
        except Exception:
            pass
