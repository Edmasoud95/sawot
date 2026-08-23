import type OpenAI from "openai";
import { executeTool, toOpenAiTools, touchedIdsFor, type Tool } from "./tools.js";

export type HistoryMessage = Record<string, any>;

const INTRO_SASSY = "You are {name}, a sassy voice assistant for a smart home, ";
const INTRO_PLAIN = "You are {name}, a friendly voice assistant for a smart home, ";

const INTRO_TAIL =
  "speaking with the user out loud. Keep replies short, natural and speakable — " +
  "one or two sentences, no markdown, no lists, no emojis.";

const PERSONA =
  "\n\nYou have personality: you're witty, a little sarcastic, and you tease the user " +
  "while still getting the job done. After doing a chore for them you might quip " +
  "something like \"Next time do it yourself.\" When the user asks you to control or " +
  "find something that doesn't exist, don't just say you can't — be playfully " +
  "incredulous, e.g. \"Hmm, interesting. Is that thing in the room with us right " +
  "now? Want me to help you book a psychiatrist appointment instead?\" Keep the " +
  "sass light and good-natured; never be genuinely mean, and always still help.";

const FUNCTIONAL =
  "\n\nYou control Home Assistant devices with the provided tools. Use the device " +
  "list below to pick entity_ids directly when acting. The list's states are a " +
  "snapshot and may be stale — when the user asks about a device's current " +
  "state, check it live with get_entities instead of answering from the list. " +
  "The list contains only controllable devices — readings such as temperature, " +
  "humidity or power are NOT listed; fetch those with " +
  "get_entities(domain='sensor', area=...), and pick the matching sensor from " +
  "the result. After acting, confirm briefly what you did. If something fails, " +
  "say so plainly. You may also answer general questions conversationally." +
  "\n\nDevices:\n{summary}";

export function buildSystemPrompt(
  entitySummary: string,
  sassy = true,
  name = "Rita",
): string {
  const intro = (sassy ? INTRO_SASSY : INTRO_PLAIN).replace("{name}", name);
  const persona = sassy ? PERSONA : "";
  return (intro + INTRO_TAIL + persona + FUNCTIONAL).replace("{summary}", entitySummary);
}

function truncate(s: string, limit = 600): string {
  return s.length <= limit ? s : s.slice(0, limit) + "…";
}

export class Agent {
  static MAX_ROUNDS = 5;

  constructor(
    private client: OpenAI,
    private model: string,
    private tools: Tool[],
    private system: string,
  ) {}

  get currentModel(): string {
    return this.model;
  }

  setModel(model: string): void {
    this.model = model;
  }

  setSystemPrompt(system: string): void {
    this.system = system;
  }

  async run(
    history: HistoryMessage[],
    userText: string,
    onEvent?: (event: string, data: any) => void | Promise<void>,
  ): Promise<string> {
    const emit = async (event: string, data: any) => {
      if (!onEvent) return;
      try {
        await onEvent(event, data);
      } catch {
        /* observer failure must not break the turn */
      }
    };

    history.push({ role: "user", content: userText });

    for (let round = 1; round <= Agent.MAX_ROUNDS; round++) {
      const t0 = performance.now();
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [{ role: "system", content: this.system }, ...history] as any,
        tools: toOpenAiTools(this.tools) as any,
      });
      const msg = response.choices[0].message;
      await emit("llm_round", {
        round,
        latency_ms: Math.round(performance.now() - t0),
        tool_calls: msg.tool_calls
          ? msg.tool_calls.map((tc: any) => tc.function.name)
          : null,
      });

      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        const reply = (msg.content ?? "").trim();
        history.push({ role: "assistant", content: reply });
        return reply;
      }

      history.push({ role: "assistant", content: msg.content, tool_calls: msg.tool_calls });

      for (const tc of msg.tool_calls as any[]) {
        const t1 = performance.now();
        let args: Record<string, any> = {};
        let result: any;
        try {
          args = JSON.parse(tc.function.arguments || "{}");
          await emit("tool_call", { name: tc.function.name, args });
          result = await executeTool(this.tools, tc.function.name, args);
        } catch (e: any) {
          await emit("tool_call", { name: tc.function.name, args: tc.function.arguments });
          result = { error: "invalid tool arguments: " + (e?.message ?? e) };
        }
        const content = JSON.stringify(result);
        await emit("tool_result", {
          name: tc.function.name,
          latency_ms: Math.round(performance.now() - t1),
          size_chars: content.length,
          result: truncate(content),
        });
        const ids = touchedIdsFor(this.tools, tc.function.name, args, result);
        if (ids.length) await emit("touched", { entity_ids: ids });
        history.push({ role: "tool", tool_call_id: tc.id, content });
      }
    }

    const reply = "Sorry, I couldn't complete that.";
    history.push({ role: "assistant", content: reply });
    return reply;
  }
}
