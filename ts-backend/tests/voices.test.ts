import assert from "node:assert/strict";
import test from "node:test";
import { resolveVoice, KOKORO_VOICES } from "../src/settings.js";
import { InferenceClient } from "../src/inference.js";

test("a voice the active engine knows is kept; otherwise the engine default wins", () => {
  assert.equal(resolveVoice(["default", "alice"], "af_heart", "default"), "default");
  assert.equal(resolveVoice(["default", "alice"], "alice", "default"), "alice");
  assert.equal(resolveVoice(KOKORO_VOICES, "am_adam", "af_heart"), "am_adam");
  assert.equal(resolveVoice([], "anything", "af_heart"), "anything", "an empty list means the sidecar is unknown; keep the setting");
});

test("the inference client reads the active engine's voices from the sidecar", async () => {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any) => { calls.push(String(url)); return { ok: true, json: async () => ({ engine: "chatterbox-nano", voices: ["default", "alice"], default: "default" }) }; }) as any;
  try {
    const client = new InferenceClient("http://sidecar");
    assert.deepEqual(await client.voices(), { engine: "chatterbox-nano", voices: ["default", "alice"], default: "default" });
    assert.deepEqual(calls, ["http://sidecar/api/voices"]);
  } finally { globalThis.fetch = original; }
});
