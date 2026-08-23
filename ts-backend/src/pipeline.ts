import type { Agent, HistoryMessage } from "./agent.js";
import type { InferenceClient } from "./inference.js";

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
  } catch {
    await send("error", { message: "speech engine offline" });
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
  const onAgentEvent = async (event: string, data: any) => {
    if (event === "touched") {
      for (const eid of data.entity_ids ?? []) {
        if (!touched.includes(eid)) touched.push(eid);
      }
      return;
    }
    await send("debug", { event, data });
  };

  const checkpoint = history.length;
  let reply: string;
  try {
    reply = await agent.run(history, text, onAgentEvent);
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
  } catch {
    await send("error", { message: "speech engine offline" });
    return;
  }
  await send("debug", {
    event: "tts",
    data: { latency_ms: Math.round(performance.now() - t1), bytes: wav.length },
  });
  await send("wav", wav);
}
