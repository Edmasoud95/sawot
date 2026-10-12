import { pythonPreference } from "./pythonPreference";
import { API_BASE } from "./config";

async function json(res) {
  if (!res.ok) throw Object.assign(new Error((await res.json()).detail || res.statusText), { status: res.status });
  return res.json();
}

export const listConversations = (query = "", signal?: AbortSignal) =>
  fetch(`${API_BASE}/api/chat/conversations${query ? `?q=${encodeURIComponent(query)}` : ""}`, { signal }).then(json);
export const createConversation = (model, signal?: AbortSignal) =>
  fetch(`${API_BASE}/api/chat/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({ ...(model ? { model } : {}), python: pythonPreference() }),
  }).then(json);
export const cancelConversationTurn = (id) =>
  fetch(`${API_BASE}/api/chat/conversations/${id}/cancel`, { method: "POST" }).then(res => {
    if (!res.ok) throw new Error("Could not stop the response.");
  });
export const branchConversation = (id: string, messageIndex: number, expectedMessageCount: number, expectedMessageId?: string) =>
  fetch(`${API_BASE}/api/chat/conversations/${id}/branch`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ messageIndex, expectedMessageCount, expectedMessageId }),
  }).then(json);
export const getConversation = (id, signal?: AbortSignal) =>
  fetch(`${API_BASE}/api/chat/conversations/${id}`, { signal, cache: "no-store" }).then(json);
export const patchConversation = (id, patch, keepalive = false) => {
  const body = JSON.stringify(patch);
  return fetch(`${API_BASE}/api/chat/conversations/${id}`, {
    method: "PATCH",
    keepalive: keepalive && new TextEncoder().encode(body).length < 60_000,
    headers: { "Content-Type": "application/json" },
    body,
  }).then(json);
};
export const deleteConversation = (id) =>
  fetch(`${API_BASE}/api/chat/conversations/${id}`, { method: "DELETE" }).then(async res => {
    if (!res.ok) throw new Error("Could not delete the conversation and its files. Please try again.");
  });
export const uploadFile = (file, conversationId = null) => {
  const form = new FormData();
  form.append("file", file);
  return fetch(`${API_BASE}/api/chat/upload${conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : ""}`, { method: "POST", body: form }).then(json);
};

/** POST starts a turn; GET only subscribes to the already-running turn. */
export function streamMessage(conversationId, body, onEvent) {
  return readChatStream(`${API_BASE}/api/chat/conversations/${conversationId}/messages`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }, onEvent);
}

export function resumeMessage(conversationId, onEvent) {
  return readChatStream(`${API_BASE}/api/chat/conversations/${conversationId}/stream`, {
    cache: "no-store",
  }, onEvent);
}

function readChatStream(url, init, onEvent) {
  const controller = new AbortController();
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let content = "";
  let thinking = "";
  let firstText = true;
  const flush = () => {
    clearTimeout(timer); timer = undefined;
    if (cancelled) { content = ""; thinking = ""; return; }
    if (thinking) { const delta = thinking; thinking = ""; onEvent({ type: "thinking", delta }); }
    if (content) { const delta = content; content = ""; onEvent({ type: "content", delta }); }
  };
  const receive = event => {
    if (cancelled) return;
    if (event.type === "content" || event.type === "thinking") {
      // Flush before changing channels so batching cannot reorder thinking and replies.
      if ((event.type === "content" && thinking) || (event.type === "thinking" && content)) flush();
      if (event.type === "content") content += event.delta; else thinking += event.delta;
      if (firstText) { firstText = false; flush(); return; }
      // Bound markdown parsing/rendering to ~30 updates/s, independent of token rate.
      timer ??= setTimeout(flush, 32);
    } else { flush(); onEvent(event); }
  };
  const watch = (ms: number) => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => controller.abort(), ms);
  };
  (async () => {
    try {
      watch(10000);
      const res = await fetch(url, { ...init, signal: controller.signal });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        receive({ type: "error", rejected: true, message: detail.detail || `HTTP ${res.status}` });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        // Server heartbeats also detect a silently dead mobile connection.
        watch(45000);
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          if (line.startsWith("data: ")) receive(JSON.parse(line.slice(6)));
        }
      }
    } catch (e) {
      if (!cancelled) receive({ type: "error", interrupted: true,
        message: "Connection interrupted before the response finished. Please try again.", detail: String(e) });
    } finally {
      clearTimeout(watchdog);
      flush();
      if (!cancelled) onEvent({ type: "stream_end" });
    }
  })();
  return () => { cancelled = true; clearTimeout(watchdog); clearTimeout(timer); controller.abort(); };
}
