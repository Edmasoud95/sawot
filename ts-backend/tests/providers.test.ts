import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { ProviderRegistry, probeEndpoint } from "../src/providers.js";

// A provider that accepts the connection and never answers, like a sleeping
// local model host, next to one that answers at once.
function servers() {
  const hanging = createServer(() => { /* never respond */ });
  const healthy = createServer((_req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ data: [{ id: "deepseek-v4" }, { id: "text-embedding-3-small" }, { id: "tts-1" }, { id: "custom-image", architecture: { output_modalities: ["image"] } }] })); });
  return Promise.all([hanging, healthy].map((s) => new Promise<number>((resolve) => s.listen(0, () => resolve((s.address() as any).port))))).then(([h, k]) => ({
    hangingUrl: `http://127.0.0.1:${h}/v1`, healthyUrl: `http://127.0.0.1:${k}/v1`, close: () => { hanging.closeAllConnections?.(); hanging.close(); healthy.close(); },
  }));
}

test("an unresponsive provider times out quickly and the others still list their models", async () => {
  const s = await servers();
  try {
    const registry = new ProviderRegistry(
      { id: "local", name: "Local server", baseUrl: s.hangingUrl, builtin: true },
      [{ id: "deepseek", name: "DeepSeek", baseUrl: s.healthyUrl, apiKey: "k" }],
      { timeoutMs: 300 },
    );
    const t = Date.now();
    const listed = await registry.listAllModels();
    assert.ok(Date.now() - t < 1500, `listing must not wait on the hung provider (took ${Date.now() - t} ms)`);
    const byId = Object.fromEntries(listed.map((p) => [p.id, p]));
    assert.deepEqual(byId.deepseek.models, ["deepseek-v4"]);
    assert.equal(byId["local"].models.length, 0);
    assert.match(byId["local"].error ?? "", /timed out/i);
  } finally { s.close(); }
});

test("probing a new provider endpoint also gives up instead of hanging", async () => {
  const s = await servers();
  try {
    const t = Date.now();
    await assert.rejects(probeEndpoint(s.hangingUrl, undefined, 300), /timed out/i);
    assert.ok(Date.now() - t < 1500);
  } finally { s.close(); }
});

test("provider probing and seeded caches only publish chat model choices", async () => {
  const s = await servers();
  try {
    assert.deepEqual(await probeEndpoint(s.healthyUrl), ["deepseek-v4"]);
    const registry = new ProviderRegistry({ id: "local", name: "Local", baseUrl: s.healthyUrl });
    registry.setModels("local", ["deepseek-v4", "text-embedding-3-small", "gpt-image-1"]);
    assert.deepEqual(registry.listing()[0].models, ["deepseek-v4"]);
  } finally { s.close(); }
});

test("effort capabilities are provider-specific and never guessed from a custom model name", () => {
  const registry = new ProviderRegistry({ id: "local", name: "Local", baseUrl: "http://localhost:1234/v1" }, [
    { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  ]);
  registry.setModels("openai", ["gpt-6-astra", "gpt-5.2", "gpt-5.2-chat-latest", "gpt-99"]);
  const listing = registry.listing().find(p => p.id === "openai") as any;
  assert.deepEqual(listing.effortLevels?.["gpt-6-astra"], ["low", "medium", "high", "xhigh", "max"]);
  assert.deepEqual(listing.effortLevels?.["gpt-5.2"], ["none", "low", "medium", "high", "xhigh"]);
  assert.equal(listing.effortLevels?.["gpt-5.2-chat-latest"], undefined);
  assert.equal(listing.effortLevels?.["gpt-99"], undefined);
  assert.deepEqual((registry as any).effortLevelsFor("local::gpt-6-astra"), []);
});

test("explicit model metadata supplies effort steps, including an explicit unsupported list", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [
    { id: "custom", supported_reasoning_efforts: ["high", "low", "high", "nonsense"] },
    { id: "gpt-5.2", supported_reasoning_efforts: [] },
    { id: "gpt-6-astra", supported_parameters: ["reasoning"] },
  ] }), { status: 200 });
  try {
    const registry = new ProviderRegistry({ id: "local", name: "Local", baseUrl: "http://localhost:1234/v1" });
    const listing = await registry.refresh("local") as any;
    assert.deepEqual(listing.effortLevels?.custom, ["low", "high"]);
    assert.deepEqual((registry as any).effortLevelsFor("local::gpt-5.2"), []);
    assert.deepEqual((registry as any).effortLevelsFor("local::gpt-6-astra"), []);
  } finally { globalThis.fetch = original; }
});

test("unknown model IDs cannot inherit catalogue object properties", () => {
  const registry = new ProviderRegistry({ id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1" });
  registry.setModels("openai", ["constructor", "toString", "__proto__"]);
  assert.doesNotThrow(() => registry.listing());
  for (const id of ["constructor", "toString", "__proto__"]) assert.deepEqual(registry.effortLevelsFor(id), []);
});

test("native LM Studio effort discovery matches loaded aliases and preserves explicit overrides", async () => {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input); urls.push(url);
    return new Response(JSON.stringify(url.endsWith('/api/v1/models') ? { models: [
      { type: "llm", key: "qwen/model", loaded_instances: [{ id: "loaded-alias" }], capabilities: { reasoning: { allowed_options: ["off", "low", "medium", "xhigh", "on"] } } },
      { type: "llm", key: "toggle", capabilities: { reasoning: { allowed_options: ["off", "on"] } } },
      { type: "llm", key: "blocked", capabilities: { reasoning: { allowed_options: ["low", "high"] } } },
    ] } : { data: [{ id: "loaded-alias" }, { id: "toggle" }, { id: "blocked", supported_reasoning_efforts: [] }] }));
  };
  try {
    const registry = new ProviderRegistry({ id: "custom", name: "My desktop", baseUrl: "http://localhost:1234/proxy/v1" });
    const listing = await registry.refresh("custom");
    assert.deepEqual(listing.effortLevels?.["loaded-alias"], ["none", "low", "medium", "xhigh"]);
    assert.deepEqual(registry.effortLevelsFor("custom::loaded-alias"), ["none", "low", "medium", "xhigh"]);
    assert.deepEqual(registry.effortLevelsFor("custom::toggle"), []);
    assert.deepEqual(registry.effortLevelsFor("custom::blocked"), []);
    assert.ok(urls.includes("http://localhost:1234/proxy/api/v1/models"));
    globalThis.fetch = async input => {
      if (String(input).endsWith('/api/v1/models')) throw new Error("Native metadata offline");
      return new Response(JSON.stringify({ data: [{ id: "loaded-alias" }] }));
    };
    const updated = await registry.refresh("custom");
    assert.equal(updated.state, "ready");
    assert.deepEqual(registry.effortLevelsFor("custom::loaded-alias"), ["none", "low", "medium", "xhigh"]);
    globalThis.fetch = async input => new Response(JSON.stringify(String(input).endsWith('/api/v1/models')
      ? { models: [{ type: "llm", key: "loaded-alias", capabilities: { reasoning: { allowed_options: ["on"] } } }] }
      : { data: [{ id: "loaded-alias" }] }));
    await registry.refresh("custom");
    assert.deepEqual(registry.effortLevelsFor("custom::loaded-alias"), []);
  } finally { globalThis.fetch = original; }
});
