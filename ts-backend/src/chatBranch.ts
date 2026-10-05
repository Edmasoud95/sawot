import { newId, SAFE_ID, type ChatStore } from "./chat.js";
import type { AnalysisFileStore } from "./analysis/fileStore.js";
import { visibleTurns } from "./analysis/routes.js";

/** Copy a saved prefix, never transient drafts, errors or in-flight work. */
export function branchConversation(store: ChatStore, source: any, index: number, files?: AnalysisFileStore) {
  const now = Date.now() / 1000;
  const branch = {
    id: newId(), title: `Branch: ${source.title || "New chat"}`.slice(0, 80),
    model: source.model, reasoningEffort: source.reasoningEffort ?? null,
    homeAssistant: Boolean(source.homeAssistant), webSearch: source.webSearch !== false, python: source.python !== false,
    created: now, updated: now, draftText: "",
    messages: structuredClone(source.messages.slice(0, index + 1)),
    uploadIds: [] as string[],
  };
  branch.uploadIds = [...new Set<string>(branch.messages.flatMap((m: any) =>
    (m.attachments ?? []).map((a: any) => a.id)).filter((id: unknown) => typeof id === "string" && SAFE_ID.test(id)))];
  const turns = visibleTurns(branch);
  if (!files && branch.messages.some((m: any) => (m.analysis ?? []).some((event: any) => event.file || event.result?.files?.length))) {
    throw new Error("Analysis file storage is unavailable");
  }
  // Staging and copying are synchronous, so other requests cannot see a partial branch.
  store.save(branch);
  try {
    const mapping = files?.cloneVisible({ conversationId: source.id, turnId: turns[0] ?? "000000000000", visibleTurnIds: turns },
      { conversationId: branch.id, turnId: turns[0] ?? "000000000000", visibleTurnIds: turns }) ?? new Map<string, string>();
    const remap = (value: any): any => {
      if (typeof value === "string") {
        let result = value.replaceAll(`/api/chat/conversations/${source.id}/analysis-files/`, `/api/chat/conversations/${branch.id}/analysis-files/`);
        for (const [original, copy] of mapping) result = result.replaceAll(original, copy);
        return result;
      }
      if (Array.isArray(value)) return value.map(remap);
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) =>
        [key, key === "conversationId" && child === source.id ? branch.id : remap(child)]));
      return value;
    };
    branch.messages = remap(branch.messages);
    for (const message of branch.messages) {
      if (message.role === "assistant" && message.id) message.memorySourceConversationId ??= source.id;
    }
    store.save(branch);
    return branch;
  } catch (error) {
    try { files?.deleteConversation(branch.id); } finally { store.delete(branch.id); }
    throw error;
  }
}
