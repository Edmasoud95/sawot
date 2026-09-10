import assert from "node:assert/strict";
import test from "node:test";
import { Agent } from "../src/agent.js";
import { InferenceError } from "../src/inference.js";
import { runVoiceTurn } from "../src/pipeline.js";

const agent = { run: async () => "hello" } as unknown as Agent;

test("a sidecar 'model not downloaded' detail reaches the caption", async () => {
  const events: any[] = [];
  const inference = {
    transcribe: async () => { throw new InferenceError(503, "speech-to-text model 'cohere-transcribe' is not downloaded yet — open Settings and download it", "transcribe"); },
    synthesize: async () => Buffer.from("wav"),
  };
  await runVoiceTurn(inference as never, agent, Buffer.from("audio"), [], (type, data) => { events.push({ type, ...data }); }, "v");
  const error = events.find((e) => e.type === "error");
  assert.match(error.message, /not downloaded yet/);
});

test("an unexplained sidecar failure still reads as offline", async () => {
  const events: any[] = [];
  const inference = { transcribe: async () => { throw new Error("ECONNREFUSED"); }, synthesize: async () => Buffer.from("wav") };
  await runVoiceTurn(inference as never, agent, Buffer.from("audio"), [], (type, data) => { events.push({ type, ...data }); }, "v");
  assert.equal(events.find((e) => e.type === "error").message, "speech engine offline");
});
