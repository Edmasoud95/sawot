import { DEFAULT_LIVE_BACKEND_PROMPT } from "./livePrompts.js";
import type { Agent } from "./agent.js";
import { stripSpeechTags } from "./speechTags.js";

export interface LiveTurn { role: "user" | "assistant"; text: string; start: number; end: number }
export interface LiveToolResult { content: string; searches: any[] }

export const liveBackendPrompt = (system: string, custom = "") => (custom.trim() || DEFAULT_LIVE_BACKEND_PROMPT).replace(/\{device_context\}/g, () => system);

/** Conservative byte limit keeps commentary below the Live 500-token limit. */
function shortResult(text: string) {
  const clean = stripSpeechTags(text).trim();
  if (Buffer.byteLength(clean) <= 450) return clean;
  let result = "";
  for (const char of clean) { if (Buffer.byteLength(result + char) > 420) break; result += char; }
  return result + "… (result shortened)";
}

/** Serial, at-most-once work for one Live connection; never retries actions. */
export class LiveToolSession {
  private controller = new AbortController();
  private requests = new Map<string, Promise<LiveToolResult>>();
  private queue: Promise<unknown> = Promise.resolve();
  private previousUser = "";
  private previousEnd = -1;
  private records: string[] = [];
  constructor(private createAgent: () => Agent) {}
  close() { this.controller.abort(); }

  run(id: string, turns: LiveTurn[]): Promise<LiveToolResult> {
    const existing = this.requests.get(id);
    if (existing) return existing;
    if (this.requests.size >= 64) return Promise.resolve({ content: "This session has reached its task limit. Please reconnect to continue.", searches: [] });
    const work = this.queue.then(async (): Promise<LiveToolResult> => {
      const searches: any[] = [];
      const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(75_000)]);
      let attempts: string[] = [];
      try {
        signal.throwIfAborted();
        const lastUser = [...turns].reverse().find(t => t.role === "user" && t.text.trim());
        if (!lastUser) return { content: "Please ask the user to repeat the request; no usable speech transcript arrived.", searches };
        if (lastUser.end <= this.previousEnd && lastUser.text === this.previousUser) {
          return { content: "No new user request arrived. Do not repeat any action; wait for the pending result or a new request.", searches };
        }
        this.previousEnd = lastUser.end;
        this.previousUser = lastUser.text;
        const context = JSON.stringify({ conversation: turns, earlierBackendRecords: this.records });
        const result = await this.createAgent().run([], "Handle the latest real user request in this voice context:\n" + context,
          (event, data) => {
            if (event === "tool_call") attempts.push(JSON.stringify({ tool: data.name, args: data.args }).slice(0, 1000));
            if (event === "tool_result") attempts.push(JSON.stringify({ tool: data.name, ok: data.ok, result: data.result }).slice(0, 1000));
            if (event === "search" && data.phase !== "start") searches.push(data);
          }, { signal, expressions: false });
        signal.throwIfAborted();
        const content = shortResult(result) || "The backend returned no answer. Ask the user to clarify; do not claim an action succeeded.";
        this.records.push(JSON.stringify({ request: lastUser.text, attempts, result: content }));
        this.records = this.records.slice(-12);
        return { content, searches: searches.slice(-8) };
      } catch {
        // A service may have completed before cancellation reached the model.
        const content = "The task could not be completed or confirmed. Some actions may already have run. Do not repeat them automatically; check their state first.";
        this.records.push(JSON.stringify({ attempts, result: content }));
        this.records = this.records.slice(-12);
        return { content, searches: [] };
      }
    });
    this.requests.set(id, work);
    this.queue = work;
    return work;
  }
}
