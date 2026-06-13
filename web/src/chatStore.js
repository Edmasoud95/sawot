import { create } from "zustand";
import {
  listConversations,
  createConversation,
  getConversation,
  patchConversation,
  deleteConversation,
  streamMessage,
} from "./lib/chatApi";

export const useChatStore = create((set, get) => ({
  conversations: [],
  activeId: null,
  active: null,
  streaming: false,
  streamText: "",
  streamThinking: "",
  streamTools: [],
  streamCards: [],
  pendingAttachments: [],
  sidebarOpen: true,
  abortStream: null,

  loadConversations: async () => {
    try {
      const conversations = await listConversations();
      set({ conversations });
    } catch (e) {
      console.error("loadConversations failed", e);
    }
  },

  openConversation: async (id) => {
    try {
      const active = await getConversation(id);
      set({ activeId: id, active });
    } catch (e) {
      console.error("openConversation failed", e);
    }
  },

  newConversation: async (model) => {
    try {
      const conv = await createConversation(model);
      set((s) => ({
        conversations: [conv, ...s.conversations],
        activeId: conv.id,
        active: conv,
      }));
    } catch (e) {
      console.error("newConversation failed", e);
    }
  },

  removeConversation: async (id) => {
    try {
      await deleteConversation(id);
      set((s) => {
        const conversations = s.conversations.filter((c) => c.id !== id);
        const activeId = s.activeId === id ? null : s.activeId;
        const active = s.activeId === id ? null : s.active;
        return { conversations, activeId, active };
      });
    } catch (e) {
      console.error("removeConversation failed", e);
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

  addAttachment: (attachment) =>
    set((s) => ({ pendingAttachments: [...s.pendingAttachments, attachment] })),

  removeAttachment: (id) =>
    set((s) => ({
      pendingAttachments: s.pendingAttachments.filter((a) => a.id !== id),
    })),

  startStream: (content) => {
    const { activeId, active, pendingAttachments } = get();
    if (!activeId || !active || get().streaming) return;

    const userMessage = {
      role: "user",
      content,
      attachments: [...pendingAttachments],
    };

    // Push optimistic user message
    const updatedActive = {
      ...active,
      messages: [...active.messages, userMessage],
    };

    set({
      active: updatedActive,
      streaming: true,
      streamText: "",
      streamThinking: "",
      streamTools: [],
      streamCards: [],
      pendingAttachments: [],
    });

    let doneFired = false;

    const abort = streamMessage(
      activeId,
      { content, attachments: pendingAttachments },
      (event) => {
        if (event.type === "thinking") {
          set((s) => ({ streamThinking: s.streamThinking + event.delta }));
        } else if (event.type === "content") {
          set((s) => ({ streamText: s.streamText + event.delta }));
        } else if (event.type === "tool") {
          set((s) => ({ streamTools: [...s.streamTools, event] }));
        } else if (event.type === "entities") {
          set({ streamCards: event.entities });
        } else if (event.type === "done") {
          doneFired = true;
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
            streamCards: [],
          }));
        } else if (event.type === "error" && !doneFired) {
          set((s) => ({
            active: s.active
              ? {
                  ...s.active,
                  messages: [
                    ...s.active.messages,
                    { role: "assistant", content: `⚠ ${event.message}` },
                  ],
                }
              : s.active,
          }));
        } else if (event.type === "stream_end") {
          set({ streaming: false, abortStream: null });
        }
      }
    );

    set({ abortStream: abort });
  },

  stopStream: () => {
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
