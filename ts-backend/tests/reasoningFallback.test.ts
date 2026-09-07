import assert from "node:assert/strict";
import test from "node:test";
import { createChatCompletion, isReasoningToolConflict, reasoningDisabledModels, resetReasoningFallback } from "../src/reasoningFallback.js";

const NONE_REJECTED = "400 Unsupported value: 'reasoning_effort' does not support 'none' with this model. Supported values are: 'low', 'medium', 'high', and 'xhigh'.";
const CONFLICT = "400 Function tools with reasoning_effort are not supported for gpt-6-astra in /v1/chat/completions. To use function tools, use /v1/responses or set reasoning_effort to 'none'.";

function fakeClient(baseURL: string, rejectsReasoning: Set<string>) {
  const requests: any[] = [];
  const client: any = {
    baseURL,
    chat: { completions: { create: async (req: any) => {
      requests.push(req);
      if (rejectsReasoning.has(req.model) && req.reasoning_effort !== "none") {
        throw Object.assign(new Error(CONFLICT), { status: 400 });
      }
      return { ok: true, model: req.model };
    } } },
  };
  return { client, requests };
}

test.beforeEach(() => resetReasoningFallback());

test("recognises the provider's tools-versus-reasoning error", () => {
  assert.ok(isReasoningToolConflict(Object.assign(new Error(CONFLICT), { status: 400 })));
  assert.ok(isReasoningToolConflict({ status: 400, error: { message: CONFLICT } }));
  assert.ok(!isReasoningToolConflict(Object.assign(new Error("model not found"), { status: 404 })));
  assert.ok(!isReasoningToolConflict(Object.assign(new Error(CONFLICT), { status: 500 })));
  assert.ok(!isReasoningToolConflict(new Error("reasoning_effort must be one of low, medium, high")));
});

test("retries once with reasoning_effort none and remembers the model", async () => {
  const { client, requests } = fakeClient("https://api.example/v1", new Set(["gpt-6-astra"]));
  const first = await createChatCompletion(client, { model: "gpt-6-astra", messages: [], tools: [] });
  assert.deepEqual(first, { ok: true, model: "gpt-6-astra" });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].reasoning_effort, undefined);
  assert.equal(requests[1].reasoning_effort, "none");
  assert.deepEqual(requests[1].messages, []);

  await createChatCompletion(client, { model: "gpt-6-astra", messages: [], tools: [] });
  assert.equal(requests.length, 3, "second turn goes straight to the working shape");
  assert.equal(requests[2].reasoning_effort, "none");
  assert.deepEqual(reasoningDisabledModels(), ["https://api.example/v1::gpt-6-astra"]);
});

test("other models on the same endpoint are untouched", async () => {
  const { client, requests } = fakeClient("https://api.example/v1", new Set(["gpt-6-astra"]));
  await createChatCompletion(client, { model: "gpt-6-astra", messages: [] });
  await createChatCompletion(client, { model: "qwen3-8b", messages: [] });
  const last = requests[requests.length - 1];
  assert.equal(last.model, "qwen3-8b");
  assert.equal("reasoning_effort" in last, false);
});

test("unrelated errors are rethrown without a retry", async () => {
  let calls = 0;
  const client: any = { baseURL: "x", chat: { completions: { create: async () => { calls++; throw Object.assign(new Error("rate limited"), { status: 429 }); } } } };
  await assert.rejects(createChatCompletion(client, { model: "m", messages: [] }), /rate limited/);
  assert.equal(calls, 1);
  assert.deepEqual(reasoningDisabledModels(), []);
});

test("a model that rejects both shapes fails with a clear message and is not remembered", async () => {
  const requests: any[] = [];
  const client: any = { baseURL: "https://api.example/v1", chat: { completions: { create: async (req: any) => {
    requests.push(req);
    throw Object.assign(new Error(req.reasoning_effort === "none" ? NONE_REJECTED : CONFLICT), { status: 400 });
  } } } };
  await assert.rejects(createChatCompletion(client, { model: "gpt-6-astra", messages: [], tools: [] }), /Responses API/);
  assert.equal(requests.length, 2);
  assert.deepEqual(reasoningDisabledModels(), [], "a failed retry must not poison later requests");
});
