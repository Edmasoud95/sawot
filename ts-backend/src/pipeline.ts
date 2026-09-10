import type { TemperatureReading } from "./temperature.js";
import type { Agent, HistoryMessage } from "./agent.js";
import { InferenceError, type InferenceClient } from "./inference.js";

/** The sidecar's own explanation when it gave one, else a generic message. */
function speechError(e: unknown): string {
  return e instanceof InferenceError && e.detail ? e.detail : "speech engine offline";
}

export type SendFn = (kind: string, payload: any) => void | Promise<void>;

/** Run one push-to-talk turn: STT -> agent -> TTS. Transport-agnostic. */
export async function runVoiceTurn(
  inference: InferenceClient,
  agent: Agent,
  audio: Buffer,
  history: HistoryMessage[],
  send: SendFn,
  voice: string,
  getCards?: (ids: string[]) => Promise<any[]>,
): Promise<void> {
  const t0 = performance.now();
  let text: string;
  try {
    text = await inference.transcribe(audio);
  } catch (e) {
    await send("error", { message: speechError(e) });
    return;
  }
  await send("debug", {
    event: "stt",
    data: { text, latency_ms: Math.round(performance.now() - t0) },
  });
  if (!text) {
    await send("error", { message: "I didn't catch that" });
    return;
  }
  await send("transcript", { text });

  const touched: string[] = [];
  let reading: TemperatureReading | null = null;
  let expression: Record<string, unknown> | null = null;
  let activity: { tool: string; domain: string; service?: string } | null = null;
  const onAgentEvent = async (event: string, data: any) => {
    if (event === "reading") {
      reading = data;
      return;
    }
    if (event === "expression") {
      expression = data;
      return;
    }
    if (event === "touched") {
      for (const eid of data.entity_ids ?? []) {
        if (!touched.includes(eid)) touched.push(eid);
      }
      return;
    }
    // Product activity is separate from diagnostic text, including untruncated
    // success/failure information. Tool calls within a voice turn are sequential.
    if (event === "tool_call") {
      activity = null;
      const args = data.args;
      if ((data.name === "call_service" || data.name === "get_entities") &&
          args && typeof args === "object" && typeof args.domain === "string") {
        activity = {
          tool: data.name,
          domain: args.domain,
          ...(typeof args.service === "string" ? { service: args.service } : {}),
        };
        await send("activity", { ...activity, phase: "start" });
      }
    } else if (event === "tool_result" && activity?.tool === data.name) {
      await send("activity", { ...activity, phase: data.ok ? "complete" : "error" });
      activity = null;
    }
    await send("debug", { event, data });
  };

  const checkpoint = history.length;
  let reply: string;
  try {
    reply = await agent.run(history, text, onAgentEvent, { expressions: true });
  } catch {
    history.splice(checkpoint);
    await send("error", { message: "LLM backend offline" });
    return;
  }

  await send("assistant_text", { text: reply });
  if (getCards && touched.length) {
    try {
      await send("entities", { entities: await getCards(touched.slice(0, 8)) });
    } catch {
      /* card refresh is best-effort */
    }
  }

  const t1 = performance.now();
  let wav: Buffer;
  try {
    wav = await inference.synthesize(reply, voice);
  } catch (e) {
    await send("error", { message: speechError(e) });
    return;
  }
  await send("debug", {
    event: "tts",
    data: { latency_ms: Math.round(performance.now() - t1), bytes: wav.length },
  });
  // Begin the expression with playback, so slow synthesis cannot use up its lifetime.
  if (expression) await send("expression", expression);
  if (reading) await send("reading", reading);
  await send("wav", wav);
}
