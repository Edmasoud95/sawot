import assert from "node:assert/strict";
import test from "node:test";
import { conversationErrorMessage } from "../src/conversationError.js";
import { runVoiceTurn } from "../src/pipeline.js";
import { Agent } from "../src/agent.js";

test("voice pipeline reports context overflow instead of offline or image errors", async () => {
  for (const images of [[], [{ type: "image_url" as const, image_url: { url: "data:image/png;base64,AAAA" } }]]) {
    const agent = new Agent({ chat: { completions: { create: async () => {
      throw Object.assign(new Error("input rejected"), { code: "context_length_exceeded" });
    } } } } as any, "m", [], "test");
    const history: any[] = [{ role: "user", content: "earlier" }];
    const events: any[] = [];
    await runVoiceTurn({ transcribe: async () => "hello", voices: async () => ({ engine: "kokoro" }) } as any,
      agent, Buffer.from("audio"), history, (type, data) => { events.push({ type, ...data }); }, "voice",
      undefined, { providerId: "local", providerName: "Local", contextWindow: 12032 }, undefined, images);
    assert.match(events.find(e => e.type === "error").message, /conversation.*too long/i);
    assert.match(events.find(e => e.type === "error").message, /reconnect/i);
    assert.equal(events.find(e => e.event === "context").data.contextWindow, 12032);
    assert.deepEqual(history, [{ role: "user", content: "earlier" }]);
  }
});

test("context errors from different providers get actionable text", () => {
  for (const error of [
    { code: "context_length_exceeded" },
    { error: { code: "context_window_exceeded" } },
    new Error("This model's maximum context length is 8192 tokens. However, you requested 9000 tokens."),
    new Error("Trying to keep the first 15000 tokens when context the overflows. However, the model is loaded with context length of only 12032 tokens."),
    new Error("Input token count exceeds the maximum number of tokens allowed"),
  ]) {
    assert.match(conversationErrorMessage(error), /conversation.*too long/i);
    assert.match(conversationErrorMessage(error, "voice"), /reconnect/i);
  }
});

test("rate limits and invalid output limits are not mislabelled as conversation overflow", () => {
  for (const message of ["Rate limit reached for tokens per minute", "max_tokens exceeds the maximum allowed output tokens", "model not found"]) {
    assert.equal(conversationErrorMessage(new Error(message)), message);
  }
});
