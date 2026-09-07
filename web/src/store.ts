import { create } from "zustand";
import { expressionFromActivity, expressionFromPayload, expressionFromReading } from "./lib/orbExpression";

// High-frequency mic/playback level, deliberately OUTSIDE React state:
// the orb reads it per-frame in its render loop; pushing 60Hz updates
// through React would re-render the tree pointlessly. Lives in its own
// module (lib/levelBus) so lib code doesn't import app state.
export { levelBus } from "./lib/levelBus";

export const useVoiceStore = create<any>()((set) => ({
  status: "connecting", // connecting | idle | recording | thinking | speaking
  userCaption: "",
  assistantCaption: "",
  history: [], // [{ role: "user" | "assistant", text, traceId? }]
  drawerOpen: false,
  mode: localStorage.getItem("voice-mode") || "orb", // "orb" | "cards" | "chat"
  cards: [], // entity dicts from the latest `entities` event
  debugEnabled: localStorage.getItem("voice-debug") === "1",
  traces: [], // [{ id, events: [{event, data}] }], capped at MAX_TRACES
  nextTraceId: 1,
  expression: null,

  setStatus: (status) => set({ status, ...(["recording", "connecting"].includes(status) ? { expression: null } : {}) }),
  showActivity: (activity) => set((s) => ({ expression: expressionFromActivity(s.expression, activity) })),
  showReading: (reading) => set((s) => ({ expression: expressionFromReading(s.expression, reading) })),
  showExpression: (payload) => set((s) => ({ expression: expressionFromPayload(s.expression, payload) })),
  clearExpression: (expected?) => set((s) => !expected || s.expression === expected ? { expression: null } : {}),
  setUserCaption: (text) => set({ userCaption: text }),
  setAssistantCaption: (text) => set({ assistantCaption: text }),
  clearCaptions: () => set({ userCaption: "", assistantCaption: "" }),
  addTurn: (role, text, traceId = null) =>
    set((s) => ({ history: [...s.history, { role, text, traceId }] })),
  toggleDrawer: () => set((s) => ({ drawerOpen: !s.drawerOpen })),
  setMode: (mode) =>
    set(() => {
      localStorage.setItem("voice-mode", mode);
      return { mode };
    }),
  setCards: (cards) => set({ cards }),
  toggleDebug: () =>
    set((s) => {
      const debugEnabled = !s.debugEnabled;
      localStorage.setItem("voice-debug", debugEnabled ? "1" : "0");
      return { debugEnabled };
    }),
  // An "stt" event opens a new trace; everything else appends to the current
  // one. User turns store the trace id (ids survive the cap trimming).
  addDebugEvent: ({ event, data }) =>
    set((s) => {
      if (event === "stt") {
        const trace = { id: s.nextTraceId, events: [{ event, data }] };
        return {
          nextTraceId: s.nextTraceId + 1,
          traces: [...s.traces.slice(-(MAX_TRACES - 1)), trace],
        };
      }
      if (s.traces.length === 0) return {};
      const current = s.traces[s.traces.length - 1];
      return {
        traces: [
          ...s.traces.slice(0, -1),
          { ...current, events: [...current.events, { event, data }] },
        ],
      };
    }),
}));

const MAX_TRACES = 20;
