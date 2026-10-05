import { savePythonPreference } from "./lib/pythonPreference";
import { getNotificationDevice } from "./lib/pushNotifications";
import { normalizeAnalysisEvent, mergeAnalysisEvents } from "./lib/chatAnalysis";
import { create } from "zustand";
import { useDebugStore } from "./debugStore";
import { useVoiceStore } from "./store";
import { updateVoiceSearch } from "./lib/voiceSearch";
import {
  listConversations,
  cancelConversationTurn,
  createConversation,
  branchConversation,
  getConversation,
  patchConversation,
  deleteConversation,
  streamMessage,
} from "./lib/chatApi";

const attachmentDrafts = new Map<string, any[]>();
const pendingDrafts = new Map<string, { text: string; revision: number }>();
const draftRevisions = new Map<string, number>();
const deletedConversations = new Set<string>();
let draftTimer: ReturnType<typeof setTimeout> | undefined;
let draftWrites = Promise.resolve();
let streamGeneration = 0;
let navigationGeneration = 0;
let historyGeneration = 0;
let commandGeneration = 0;
let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
let recoveryRequest: AbortController | undefined;

function withHistory(conversations, active) {
  const others = conversations.filter((c) => c.id !== active.id);
  const hasMessages = active.messages.some((m) => m.role === "user");
  const text = (active.draftText ?? "").trim();
  if (!hasMessages && text.split(/\s+/u).filter(Boolean).length < 3) return others;
  return [{ ...active, isDraft: !hasMessages,
    title: hasMessages ? active.title : `Draft: ${text.replace(/\s+/gu, " ").slice(0, 80)}`,
  }, ...others];
}

function retainStream(s) {
  const hasReply = s.streamText || s.streamThinking || s.streamSearch || s.streamCards.length || s.streamAnalysis?.length || s.streamMemory?.length;
  return {
    ...(s.active && hasReply ? { active: { ...s.active, messages: [...s.active.messages, {
      role: "assistant", content: s.streamText, thinking: s.streamThinking, cards: s.streamCards, analysis: s.streamAnalysis, memory: s.streamMemory,
      ...(s.streamSearch ? { search: s.streamSearch } : {}),
    }] } } : {}),
    streamText: "", streamThinking: "", streamTools: [], streamAnalysis: [], streamMemory: [], streamSearch: null, streamCards: [],
  };
}

export const useChatStore = create<any>()((set, get) => ({
  conversations: [],
  historyLoading: false,
  historyError: "",
  creatingConversation: false,
  branchingMessage: null,
  createError: "",
  activeId: null,
  active: null,
  settingsSaving: false,
  reconciling: false,
  retryRecovery: null,
  backgroundResponding: false,
  streaming: false,
  streamText: "",
  streamThinking: "",
  streamTools: [], streamAnalysis: [], streamMemory: [],
  streamSearch: null,
  streamCards: [],
  pendingAttachments: [],
  sidebarOpen: window.matchMedia("(min-width: 640px)").matches,
  abortStream: null,
  messageError: "",
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
    const generation = ++historyGeneration;
    set({ historyLoading: true, historyError: "" });
    try {
      await get().flushDraft();
      const conversations = await listConversations("", AbortSignal.timeout(10000));
      if (generation !== historyGeneration) return false;
      set({ conversations });
      return true;
    } catch {
      if (generation === historyGeneration) set({ historyError: "Couldn’t load conversations. Check your connection and retry." });
      return false;
    } finally { if (generation === historyGeneration) set({ historyLoading: false }); }
  },

  openConversation: async (id) => {
    const navigation = ++navigationGeneration;
    if (get().activeId) attachmentDrafts.set(get().activeId, get().pendingAttachments);
    get().detachStream();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      await get().flushDraft();
      if (navigation !== navigationGeneration) return false;
      const active = await getConversation(id, controller.signal);
      if (navigation !== navigationGeneration) return false;
      set({ activeId: id, active, pendingAttachments: attachmentDrafts.get(id) ?? [], messageError: active.responseError || "", createError: "", reconciling: false, retryRecovery: null,
        backgroundResponding: Boolean(active.responding) });
      if (active.responding) void get().recoverConversation(id);
      return true;
    } catch {
      if (navigation !== navigationGeneration) return false;
      set({ messageError: "Could not open this conversation. Check your connection and try again." });
      return false;
    } finally { clearTimeout(timeout); }
  },

  newConversation: async (model) => {
    if (get().creatingConversation) return false;
    set({ creatingConversation: true, createError: "" });
    const navigation = ++navigationGeneration;
    try {
      await get().flushDraft();
      if (navigation !== navigationGeneration) return false;
      const conv = await createConversation(model, AbortSignal.timeout(10000));
      if (navigation !== navigationGeneration) return false;
      if (get().activeId) attachmentDrafts.set(get().activeId, get().pendingAttachments);
      get().detachStream();
      set((s) => ({
        pendingAttachments: [],
        activeId: conv.id,
        active: conv,
        messageError: "",
        reconciling: false,
        retryRecovery: null,
        backgroundResponding: false,
      }));
      return true;
    } catch {
      if (navigation === navigationGeneration) set({ createError: "Couldn’t create a conversation. Check your connection and retry." });
      return false;
    } finally { set({ creatingConversation: false }); }
  },

  removeConversation: async (id) => {
    try {
      await get().flushDraft();
      if (get().activeId === id) get().detachStream();
      await deleteConversation(id);
      deletedConversations.add(id);
      attachmentDrafts.delete(id);
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

  // Read-only recovery also works after reopening the page: the backend owns
  // the turn and exposes its current snapshot until the full answer is saved.
  recoverConversation: (id, options: { revision?: number; onSaved?: (saved: any) => void; error?: string } = {}) => {
    const revision = options.revision ?? streamGeneration;
    const current = () => get().activeId === id && streamGeneration === revision;
    let reading = false;
    let failures = 0;
    const refresh = async () => {
      if (reading || !current()) return;
      reading = true;
      clearTimeout(recoveryTimer);
      set({ reconciling: true, retryRecovery: refresh });
      const controller = new AbortController();
      recoveryRequest = controller;
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const saved = await getConversation(id, controller.signal);
        if (!current()) return;
        failures = 0;
        const responding = Boolean(saved.responding);
        set(s => ({ active: { ...s.active, messages: saved.messages, title: saved.title },
          backgroundResponding: responding, reconciling: responding,
          retryRecovery: responding ? refresh : null,
          messageError: saved.responseError || (responding ? "Response is still being generated." : options.error || ""),
          conversations: s.conversations.map(c => c.id === id ? { ...c, title: saved.title } : c),
        }));
        if (responding) recoveryTimer = setTimeout(() => { void refresh(); }, 1000);
        else options.onSaved?.(saved);
      } catch {
        if (current()) {
          set({ messageError: "Reconnecting to your conversation… Your response continues on the server." });
          recoveryTimer = setTimeout(() => { void refresh(); }, Math.min(1000 * 2 ** failures++, 15000));
        }
      } finally {
        clearTimeout(timeout);
        if (recoveryRequest === controller) recoveryRequest = undefined;
        reading = false;
      }
    };
    return refresh();
  },

  resumeConversation: () => {
    const state = get();
    if (state.retryRecovery) return state.retryRecovery();
    // Refresh even when a stale stream error has already marked the UI idle.
    // A send still preparing its draft must be allowed to finish preparation.
    if (!state.activeId || (state.streaming && !state.abortStream)) return;
    state.detachStream();
    return get().recoverConversation(state.activeId);
  },

  renameModel: (model: string) => get().saveModelSettings({ model }),
  setEffort: (reasoningEffort: string | null) => get().saveModelSettings({ reasoningEffort }),

  saveModelSettings: async (patch: { model?: string; reasoningEffort?: string | null }) => {
    const { activeId } = get();
    if (!activeId) return;
    if (get().settingsSaving) throw new Error("Model settings are still saving. Please try again.");
    set({ settingsSaving: true });
    try {
      const updated = await patchConversation(activeId, patch);
      const fields = { ...(updated.model ? { model: updated.model } : {}), reasoningEffort: updated.reasoningEffort ?? null };
      set((s) => ({
        active: s.activeId === activeId && s.active ? { ...s.active, ...fields } : s.active,
        conversations: s.conversations.map((c) => c.id === activeId ? { ...c, ...fields } : c),
      }));
    } finally { set({ settingsSaving: false }); }
  },

  setTool: async (tool: "homeAssistant" | "webSearch" | "python", enabled: boolean) => {
    const { activeId } = get();
    if (!activeId) return;
    const updated = await patchConversation(activeId, { [tool]: enabled });
    if (tool === "python") savePythonPreference(updated.python !== false);
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

  branchMessage: async (index: number) => {
    const source = get().active;
    if (!source || !Number.isInteger(index) || index < 0 || index >= source.messages.length ||
      get().branchingMessage !== null || get().streaming || get().backgroundResponding || get().settingsSaving || get().reconciling) return false;
    const navigation = ++navigationGeneration;
    set({ branchingMessage: index, messageError: "" });
    try {
      await get().flushDraft();
      if (navigation !== navigationGeneration) return false;
      const branch = await branchConversation(source.id, index, source.messages.length, source.messages[index].id);
      set(s => ({ conversations: withHistory(s.conversations, branch) }));
      if (navigation !== navigationGeneration) return false;
      attachmentDrafts.set(source.id, get().pendingAttachments);
      get().detachStream();
      set({ activeId: branch.id, active: branch, pendingAttachments: [], messageError: "", createError: "",
        reconciling: false, retryRecovery: null, backgroundResponding: false });
      return true;
    } catch (error) {
      if (navigation === navigationGeneration) set({ messageError: error instanceof Error && error.name !== "TimeoutError"
        ? `Could not branch: ${error.message}` : "Could not create the branch. Check your connection and try again." });
      return false;
    } finally { set({ branchingMessage: null }); }
  },

  regenerateMessage: (index: number) => {
    const messages = get().active?.messages ?? [];
    if (!Number.isInteger(index) || index < 0 || index >= messages.length) return;
    let from = index;
    while (from >= 0 && messages[from].role !== "user") from--;
    if (from >= 0) return get().startStream("", from);
  },

  editMessage: (index: number, content: string) => {
    const message = get().active?.messages[index];
    if (!Number.isInteger(index) || index < 0 || message?.role !== "user" ||
      typeof content !== "string" || (!content.trim() && !message.attachments?.length)) return;
    return get().startStream(content, index, true);
  },

  startStream: async (content, regenerateFrom?: number, editing = false) => {
    const { activeId, active, pendingAttachments } = get();
    if (!activeId || !active || get().streaming || get().settingsSaving || get().reconciling || get().branchingMessage !== null) return;
    const regenerating = regenerateFrom !== undefined;
    const command = !regenerating && /^\/(status|help)$/i.exec(content.trim())?.[1].toLowerCase();
    if (command) return get().runCommand(command);
    get().dismissCommand();
    const generation = ++streamGeneration;
    set({ streaming: true, messageError: "" });
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
    const updatedActive = regenerating ? get().active : {
      ...get().active,
      draftText: "",
      updated: Date.now() / 1000,
      messages: [...active.messages, userMessage],
    };

    set({
      active: updatedActive,
      conversations: withHistory(get().conversations, updatedActive),
      streaming: true,
      backgroundResponding: true,
      streamText: "",
      streamThinking: "",
      streamTools: [], streamAnalysis: [], streamMemory: [],
      streamSearch: null,
      streamCards: [],
      ...(!regenerating ? { pendingAttachments: [] } : {}),
    });

    const restoreMessages = () => {
      if (regenerating && get().activeId === activeId) set((s) => ({ active: { ...s.active, messages: active.messages }, streamText: "", streamThinking: "", streamTools: [], streamAnalysis: [], streamMemory: [], streamSearch: null, streamCards: [] }));
    };
    const reconcile = () => get().recoverConversation(activeId, {
      revision: generation,
      error: responseError ? get().messageError : "",
      onSaved: (saved) => {
        const unsent = !regenerating && saved.messages.length === active.messages.length;
        if (unsent) set(s => ({ active: { ...s.active, draftText: s.active.draftText || content },
          pendingAttachments: [...pendingAttachments, ...s.pendingAttachments] }));
      },
    });
    let doneFired = false;
    let responseError = false;
    let cancelled = false;
    const debug = () => (useVoiceStore.getState().debugEnabled ? useDebugStore.getState() : null);
    const debugTurn = debug()?.beginTurn("chat", { event: "user", data: { text: content, attachments: pendingAttachments.length } });
    const finishDebug = (outcome: "completed" | "failed" | "cancelled", error?: string) => {
      if (debugTurn !== undefined) useDebugStore.getState().finishTurn(debugTurn, outcome, error);
    };

    const abort = streamMessage(
      activeId,
      { ...(regenerating ? { regenerateFrom, expectedMessageCount: active.messages.length, ...(editing ? { content } : {}) } : { content, attachments: pendingAttachments }),
        notificationDevice: getNotificationDevice() },
      (event) => {
        if (cancelled || generation !== streamGeneration || get().activeId !== activeId) return;
        if (!["content", "thinking", "memory"].includes(event.type)) {
          const safeEvent = event.type === "done" ? { ...event, message: { ...event.message, memory: undefined } } : event;
          debug()?.logMessage("in", safeEvent);
        }
        if (event.type === "regenerating" && regenerating) {
          const messages = active.messages.slice(0, regenerateFrom + 1);
          if (editing) messages[regenerateFrom] = { ...messages[regenerateFrom], content };
          set((s) => ({ active: { ...s.active, messages } }));
        } else if (event.type === "debug") {
          if (debugTurn !== undefined) debug()?.addEvent(event, debugTurn);
        } else if (event.type === "thinking") {
          set((s) => ({ streamThinking: s.streamThinking + event.delta }));
        } else if (event.type === "content") {
          set((s) => ({ streamText: s.streamText + event.delta }));
        } else if (event.type === "tool") {
          set((s) => ({ streamTools: [...s.streamTools, event] }));
        } else if (event.type === "memory") {
          set(s => ({ streamMemory: [...s.streamMemory.filter(e => e.id !== event.id), event] }));
        } else if (event.type === "analysis") {
          const analysis = normalizeAnalysisEvent(event);
          if (analysis) set(s => ({ streamAnalysis: mergeAnalysisEvents(s.streamAnalysis, analysis) }));
        } else if (event.type === "search") {
          set((s) => ({ streamSearch: updateVoiceSearch(s.streamSearch, event) }));
        } else if (event.type === "entities") {
          set({ streamCards: event.entities });
        } else if (event.type === "done") {
          doneFired = true;
          set({ backgroundResponding: false });
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
            streamTools: [], streamAnalysis: [], streamMemory: [],
            streamSearch: null,
            streamCards: [],
          }));
        } else if (event.type === "error" && !doneFired) {
          finishDebug("failed", event.message);
          responseError = !event.interrupted;
          if (event.interrupted) {
            set({ messageError: "Connection interrupted. Reloading the saved answer." });
            return;
          }
          set({ backgroundResponding: false });
          if (event.rejected && !regenerating) {
            set((s) => ({ active: { ...s.active, messages: active.messages, draftText: s.active.draftText || content },
              pendingAttachments: [...pendingAttachments, ...s.pendingAttachments], messageError: event.message }));
            get().setDraftText(get().active.draftText);
            return;
          }
          if (regenerating) {
            restoreMessages();
            set({ messageError: event.message });
            return;
          }
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
          if (!doneFired) {
            finishDebug("failed", "Connection ended before the response completed");
            restoreMessages();
            if (regenerating || !responseError) {
              if (!regenerating) set(retainStream);
              if (!get().messageError) set({ messageError: "Connection interrupted. Reloading the saved answer." });
              void reconcile();
            }
          }
          set({ streaming: false, abortStream: null });
        }
      }
    );

    set({ abortStream: () => {
      cancelled = true;
      if (!doneFired) restoreMessages();
      finishDebug("cancelled");
      abort();
    } });
  },

  detachStream: () => {
    get().dismissCommand();
    streamGeneration++;
    clearTimeout(recoveryTimer);
    recoveryRequest?.abort();
    recoveryRequest = undefined;
    const { abortStream } = get();
    if (abortStream) abortStream();
    if (get().streaming) set(retainStream);
    set({ streaming: false, abortStream: null, backgroundResponding: false, reconciling: false, retryRecovery: null });
  },

  stopStream: async () => {
    const { activeId, abortStream, backgroundResponding, reconciling } = get();
    get().detachStream();
    if (!activeId || (!abortStream && !backgroundResponding && !reconciling)) return;
    const revision = streamGeneration;
    const current = () => get().activeId === activeId && streamGeneration === revision;
    const cancel = async () => {
      if (!current()) return;
      set({ reconciling: true });
      try {
        await cancelConversationTurn(activeId);
        if (current()) await get().recoverConversation(activeId, { revision });
      } catch {
        if (current()) set({ retryRecovery: cancel, messageError: "Could not stop the response. Reconnect to retry Stop." });
      }
    };
    await cancel();
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
