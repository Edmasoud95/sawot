import { create } from "zustand";

// Diagnostic trace of what the app is doing: one turn per request in voice or
// chat mode, built from the backend's debug events, plus the raw traffic in
// both directions. Kept outside the voice store so it costs nothing when the
// debug bar is off and can be cleared independently.

export interface DebugEvent { event: string; data: any; at: number }
export interface DebugTurn {
  id: number;
  mode: "voice" | "chat" | "unknown";
  startedAt: number;
  events: DebugEvent[];
  stages: { stt: number; llm: number; tools: number; tts: number };
  total: number;
  toolCalls: number;
  text: string;
  expression: unknown;
}
export interface DebugMessage { id: number; direction: "in" | "out"; payload: any; at: number }

const MAX_TURNS = 20;
const MAX_MESSAGES = 200;

function summarise(turn: DebugTurn): DebugTurn {
  const stages = { stt: 0, llm: 0, tools: 0, tts: 0 };
  let toolCalls = 0, text = turn.text, expression = turn.expression, replyLatency = 0;
  for (const { event, data } of turn.events) {
    const ms = Number(data?.latency_ms) || 0;
    if (event === "stt") stages.stt += ms;
    else if (event === "llm_round") stages.llm += ms;
    else if (event === "tool_call") toolCalls++;
    else if (event === "tool_result") stages.tools += ms;
    else if (event === "tts") stages.tts += ms;
    else if (event === "reply") {
      replyLatency = ms;
      if (typeof data?.text === "string") text = data.text;
      if (data && "expression" in data) expression = data.expression;
    }
  }
  // The reply latency spans rounds and tools; prefer it over the sum when present.
  const total = stages.stt + (replyLatency || stages.llm + stages.tools) + stages.tts;
  return { ...turn, stages, total, toolCalls, text, expression };
}

export const useDebugStore = create<{
  turns: DebugTurn[];
  messages: DebugMessage[];
  nextTurnId: number;
  nextMessageId: number;
  beginTurn: (mode: DebugTurn["mode"], first?: { event: string; data: any }) => void;
  addEvent: (event: { event: string; data: any }) => void;
  logMessage: (direction: "in" | "out", payload: any) => void;
  clear: () => void;
  clearMessages: () => void;
}>()((set) => ({
  turns: [],
  messages: [],
  nextTurnId: 1,
  nextMessageId: 1,

  beginTurn: (mode, first) =>
    set((s) => {
      const turn: DebugTurn = summarise({
        id: s.nextTurnId, mode, startedAt: Date.now(),
        events: first ? [{ ...first, at: Date.now() }] : [],
        stages: { stt: 0, llm: 0, tools: 0, tts: 0 }, total: 0, toolCalls: 0, text: "", expression: undefined,
      });
      return { nextTurnId: s.nextTurnId + 1, turns: [...s.turns.slice(-(MAX_TURNS - 1)), turn] };
    }),

  addEvent: ({ event, data }) =>
    set((s) => {
      let turns = s.turns;
      let nextTurnId = s.nextTurnId;
      if (!turns.length) {
        turns = [{ id: nextTurnId++, mode: "unknown", startedAt: Date.now(), events: [],
          stages: { stt: 0, llm: 0, tools: 0, tts: 0 }, total: 0, toolCalls: 0, text: "", expression: undefined }];
      }
      const current = turns[turns.length - 1];
      const updated = summarise({ ...current, events: [...current.events, { event, data, at: Date.now() }] });
      return { nextTurnId, turns: [...turns.slice(0, -1), updated] };
    }),

  logMessage: (direction, payload) =>
    set((s) => ({
      nextMessageId: s.nextMessageId + 1,
      messages: [...s.messages.slice(-(MAX_MESSAGES - 1)), { id: s.nextMessageId, direction, payload, at: Date.now() }],
    })),

  clear: () => set({ turns: [], messages: [] }),
  clearMessages: () => set({ messages: [] }),
}));
