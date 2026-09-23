import { create } from "zustand";
import { useDebugStore } from "./debugStore";
import { useVoiceStore } from "./store";
import { updateVoiceSearch } from "./lib/voiceSearch";
import {
  listConversations,
  createConversation,
  getConversation,
  patchConversation,
  deleteConversation,
  streamMessage,
} from "./lib/chatApi";

const pendingDrafts = new Map<string, { text: string; revision: number }>();
const draftRevisions = new Map<string, number>();
const deletedConversations = new Set<string>();
let draftTimer: ReturnType<typeof setTimeout> | undefined;
let draftWrites = Promise.resolve();
let streamGeneration = 0;
let commandGeneration = 0;

function withHistory(conversations, active) {
  const others = conversations.filter((c) => c.id !== active.id);
  const hasMessages = active.messages.some((m) => m.role === "user");
  const text = (active.draftText ?? "").trim();
  if (!hasMessages && text.split(/\s+/u).filter(Boolean).length < 3) return others;
  return [{ ...active, isDraft: !hasMessages,
    title: hasMessages ? active.title : `Draft: ${text.replace(/\s+/gu, " ").slice(0, 80)}`,
  }, ...others];
}

export const useChatStore = create<any>()((set, get) => ({
  conversations: [],
  activeId: null,
  active: null,
  streaming: false,
  streamText: "",
  streamThinking: "",
  streamTools: [],
  streamSearch: null,
  streamCards: [],
  pendingAttachments: [],
  sidebarOpen: window.matchMedia("(min-width: 640px)").matches,
  abortStream: null,
  draftError: "",
  commandResult: null,
  abortCommand: null,

  dismissCommand: () => {
    commandGeneration++;
    get().abortCommand?.();
    set({ commandResult: null, abortCommand: null });
  },

  runCommand: async (command: string) => {
    get().dismissCommand();
    const generation = commandGeneration;
    const { activeId, pendingAttachments } = get();
    set({ commandResult: { command, loading: true, content: "", error: "" } });
    get().setDraftText("");
    const current = () => generation === commandGeneration && get().activeId === activeId;
    try {
      await get().flushDraft();
    } catch {
      if (current()) set({ commandResult: { command, loading: false, content: "", error: "Could not save draft. Please try again." } });
      return;
    }
    if (!current()) return;
    let settled = false;
    const abort = streamMessage(activeId, { content: `/${command}`, attachments: pendingAttachments }, event => {
      if (!current()) return;
      if (event.type === "done") {
        settled = true;
        set({ commandResult: { ...event.message, command, loading: false, error: "" } });
      } else if (event.type === "error") {
        settled = true;
        set({ commandResult: { command, loading: false, content: "", error: event.message } });
      } else if (event.type === "stream_end") {
        set({ abortCommand: null, ...(!settled ? { commandResult: { command, loading: false, content: "", error: "Connection ended before the command completed. Please try again." } } : {}) });
      }
    });
    set({ abortCommand: abort });
  },

  loadConversations: async () => {
    try {
      await get().flushDraft();
      const conversations = await listConversations();
      set({ conversations });
    } catch (e) {
      console.error("loadConversations failed", e);
    }
  },

  openConversation: async (id) => {
    get().stopStream();
    try {
      await get().flushDraft();
      const active = await getConversation(id);
      set({ activeId: id, active, pendingAttachments: [] });
    } catch (e) {
      console.error("openConversation failed", e);
    }
  },

  newConversation: async (model) => {
    get().stopStream();
    try {
      await get().flushDraft();
      const conv = await createConversation(model);
      set((s) => ({
        pendingAttachments: [],
        activeId: conv.id,
        active: conv,
      }));
    } catch (e) {
      console.error("newConversation failed", e);
    }
  },

  removeConversation: async (id) => {
    try {
      await get().flushDraft();
      if (get().activeId === id) get().stopStream();
      await deleteConversation(id);
      deletedConversations.add(id);
      pendingDrafts.delete(id);
      draftRevisions.delete(id);
      set((s) => {
        const conversations = s.conversations.filter((c) => c.id !== id);
        const activeId = s.activeId === id ? null : s.activeId;
        const active = s.activeId === id ? null : s.active;
        return { conversations, activeId, active, draftError: "", ...(s.activeId === id ? { pendingAttachments: [] } : {}) };
      });
    } catch (e) {
      throw e;
    }
  },

  renameModel: async (model) => {
    const { activeId } = get();
    if (!activeId) return;
    try {
      const updated = await patchConversation(activeId, { model });
      set((s) => ({
        active: s.active ? { ...s.active, model: updated.model } : s.active,
        conversations: s.conversations.map((c) =>
          c.id === activeId ? { ...c, model: updated.model } : c
        ),
      }));
    } catch (e) {
      console.error("renameModel failed", e);
    }
  },

  setTool: async (tool: "homeAssistant" | "webSearch", enabled: boolean) => {
    const { activeId } = get();
    if (!activeId) return;
    const updated = await patchConversation(activeId, { [tool]: enabled });
    set((s) => ({
      active: s.activeId === activeId && s.active
        ? { ...s.active, [tool]: updated[tool] } : s.active,
      conversations: s.conversations.map((c) =>
        c.id === activeId ? { ...c, [tool]: updated[tool] } : c
      ),
    }));
  },

  setDraftText: (draftText: string) => {
    const { active } = get();
    if (!active) return;
    const updated = { ...active, draftText, updated: Date.now() / 1000 };
    const savedText = draftText.trim().split(/\s+/u).filter(Boolean).length >= 3 ? draftText : "";
    const revision = (draftRevisions.get(active.id) ?? 0) + 1;
    draftRevisions.set(active.id, revision);
    pendingDrafts.set(active.id, { text: savedText, revision });
    set((s) => ({ active: updated, conversations: withHistory(s.conversations, updated) }));
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => { void get().flushDraft().catch(() => {}); }, 350);
  },

  flushDraft: (keepalive = false) => {
    clearTimeout(draftTimer);
    const pending = [...pendingDrafts];
    pendingDrafts.clear();
    draftWrites = draftWrites.catch(() => {}).then(async () => {
      let failure: unknown;
      for (const [id, draft] of pending) {
        if (deletedConversations.has(id)) continue;
        try {
          await patchConversation(id, { draftText: draft.text }, keepalive);
        } catch (error) {
          if (deletedConversations.has(id)) continue;
          if (draftRevisions.get(id) === draft.revision) pendingDrafts.set(id, draft);
          failure = error;
        }
      }
      if (failure) {
        set({ draftError: "Could not save draft. Please try again." });
        throw failure;
      }
      if (pending.length) set({ draftError: "" });
    });
    return draftWrites;
  },

  addAttachment: (attachment) =>
    set((s) => ({ pendingAttachments: [...s.pendingAttachments, attachment] })),

  removeAttachment: (id) =>
    set((s) => ({
      pendingAttachments: s.pendingAttachments.filter((a) => a.id !== id),
    })),

  startStream: async (content) => {
    const { activeId, active, pendingAttachments } = get();
    if (!activeId || !active || get().streaming) return;
    const command = /^\/(status|help)$/i.exec(content.trim())?.[1].toLowerCase();
    if (command) return get().runCommand(command);
    get().dismissCommand();
    const generation = ++streamGeneration;
    set({ streaming: true });
    try {
      await get().flushDraft();
    } catch {
      if (generation === streamGeneration) set({ streaming: false });
      return;
    }
    if (generation !== streamGeneration || get().activeId !== activeId) return;

    const userMessage = {
      role: "user",
      content,
      attachments: [...pendingAttachments],
    };

    // Push optimistic user message
    const updatedActive = {
      ...active,
      draftText: "",
      updated: Date.now() / 1000,
      messages: [...active.messages, userMessage],
    };

    set({
      active: updatedActive,
      conversations: withHistory(get().conversations, updatedActive),
      streaming: true,
      streamText: "",
      streamThinking: "",
      streamTools: [],
      streamSearch: null,
      streamCards: [],
      pendingAttachments: [],
    });

    let doneFired = false;
    let cancelled = false;
    const debug = () => (useVoiceStore.getState().debugEnabled ? useDebugStore.getState() : null);
    const debugTurn = debug()?.beginTurn("chat", { event: "user", data: { text: content, attachments: pendingAttachments.length } });
    const finishDebug = (outcome: "completed" | "failed" | "cancelled", error?: string) => {
      if (debugTurn !== undefined) useDebugStore.getState().finishTurn(debugTurn, outcome, error);
    };

    const abort = streamMessage(
      activeId,
      { content, attachments: pendingAttachments },
      (event) => {
        if (cancelled) return;
        if (event.type !== "content" && event.type !== "thinking") debug()?.logMessage("in", event);
        if (event.type === "debug") {
          if (debugTurn !== undefined) debug()?.addEvent(event, debugTurn);
        } else if (event.type === "thinking") {
          set((s) => ({ streamThinking: s.streamThinking + event.delta }));
        } else if (event.type === "content") {
          set((s) => ({ streamText: s.streamText + event.delta }));
        } else if (event.type === "tool") {
          set((s) => ({ streamTools: [...s.streamTools, event] }));
        } else if (event.type === "search") {
          set((s) => ({ streamSearch: updateVoiceSearch(s.streamSearch, event) }));
        } else if (event.type === "entities") {
          set({ streamCards: event.entities });
        } else if (event.type === "done") {
          doneFired = true;
          finishDebug("completed");
          const msg = event.message;
          if (event.title) {
            set((s) => ({
              active: s.active
                ? { ...s.active, title: event.title }
                : s.active,
              conversations: s.conversations.map((c) =>
                c.id === activeId ? { ...c, title: event.title } : c
              ),
            }));
          }
          set((s) => ({
            active: s.active
              ? { ...s.active, messages: [...s.active.messages, msg] }
              : s.active,
            streamText: "",
            streamThinking: "",
            streamTools: [],
            streamSearch: null,
            streamCards: [],
          }));
        } else if (event.type === "error" && !doneFired) {
          finishDebug("failed", event.message);
          set((s) => ({
            active: s.active
              ? {
                  ...s.active,
                  messages: [
                    ...s.active.messages,
                    { role: "assistant", content: `⚠ ${event.message}`,
                      ...(s.streamSearch ? { search: { ...s.streamSearch,
                        phase: s.streamSearch.phase === "start" ? "error" : s.streamSearch.phase,
                      } } : {}),
                    },
                  ],
                }
              : s.active,
          }));
        } else if (event.type === "stream_end") {
          if (!doneFired) finishDebug("failed", "Connection ended before the response completed");
          set({ streaming: false, abortStream: null });
        }
      }
    );

    set({ abortStream: () => {
      cancelled = true;
      finishDebug("cancelled");
      abort();
    } });
  },

  stopStream: () => {
    get().dismissCommand();
    streamGeneration++;
    const { abortStream } = get();
    if (abortStream) abortStream();
    set({ streaming: false, abortStream: null });
  },

  patchCards: (entities) => {
    set((s) => {
      const entityMap = new Map(entities.map((e) => [e.entity_id, e]));

      const patchMessageCards = (messages) =>
        messages.map((msg) => {
          if (!msg.cards || msg.cards.length === 0) return msg;
          const updatedCards = msg.cards.map((card) =>
            entityMap.has(card.entity_id) ? entityMap.get(card.entity_id) : card
          );
          return { ...msg, cards: updatedCards };
        });

      const updatedStreamCards = s.streamCards.map((card) =>
        entityMap.has(card.entity_id) ? entityMap.get(card.entity_id) : card
      );

      return {
        active: s.active
          ? { ...s.active, messages: patchMessageCards(s.active.messages) }
          : s.active,
        streamCards: updatedStreamCards,
      };
    });
  },
}));
