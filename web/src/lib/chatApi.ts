import { API_BASE } from "./config";

async function json(res) {
  if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
  return res.json();
}

export const listConversations = () =>
  fetch(`${API_BASE}/api/chat/conversations`).then(json);
export const createConversation = (model) =>
  fetch(`${API_BASE}/api/chat/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(model ? { model } : {}),
  }).then(json);
export const getConversation = (id) =>
  fetch(`${API_BASE}/api/chat/conversations/${id}`).then(json);
export const patchConversation = (id, patch) =>
  fetch(`${API_BASE}/api/chat/conversations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }).then(json);
export const deleteConversation = (id) =>
  fetch(`${API_BASE}/api/chat/conversations/${id}`, { method: "DELETE" });
export const uploadFile = (file) => {
  const form = new FormData();
  form.append("file", file);
  return fetch(`${API_BASE}/api/chat/upload`, { method: "POST", body: form }).then(json);
};

/** POST a message; invoke onEvent for each SSE event. Returns an abort fn. */
export function streamMessage(conversationId, body, onEvent) {
  const controller = new AbortController();
  (async () => {
    try {
      const res = await fetch(
        `${API_BASE}/api/chat/conversations/${conversationId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          if (line.startsWith("data: ")) onEvent(JSON.parse(line.slice(6)));
        }
      }
      onEvent({ type: "stream_end" });
    } catch (e) {
      if (e.name !== "AbortError") onEvent({ type: "error", message: String(e) });
      else onEvent({ type: "stream_end" });
    }
  })();
  return () => controller.abort();
}
