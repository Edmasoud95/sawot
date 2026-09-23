import assert from "node:assert/strict";
import test from "node:test";
import { ProviderRegistry } from "../src/providers.js";

test("local context discovery prefers the loaded instance and refreshes after a reload", async (t) => {
  let context = 12032;
  t.mock.method(globalThis, "fetch", async (url: any) => {
    assert.equal(String(url), "http://localhost:1234/api/v1/models");
    return Response.json({ models: [{ key: "gemma", max_context_length: 131072,
      loaded_instances: [{ id: "gemma", config: { context_length: context } }] }] });
  });
  const registry = new ProviderRegistry({ id: "local", name: "Local", baseUrl: "http://localhost:1234/v1" });
  assert.equal(await registry.contextWindowFor("local::gemma"), 12032);
  assert.deepEqual(await registry.contextInfoFor("local::gemma"), { tokens: 12032, source: "loaded" });
  context = 8192;
  assert.equal(await registry.contextWindowFor("gemma"), 8192);
});

test("unloaded models use their maximum; cloud models default without native probes", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: any) => {
    assert.equal(String(url), "http://localhost:1234/api/v1/models");
    return Response.json({ models: [{ key: "gemma", max_context_length: 262144, loaded_instances: [] }] });
  });
  const registry = new ProviderRegistry({ id: "local", name: "Local", baseUrl: "http://localhost:1234/v1" },
    [{ id: "cloud", name: "Cloud", baseUrl: "https://example.com/v1" }]);
  assert.equal(await registry.contextWindowFor("gemma"), 262144);
  assert.deepEqual(await registry.contextInfoFor("gemma"), { tokens: 262144, source: "model" });
  assert.equal(await registry.contextWindowFor("cloud::model"), 128000);
  assert.deepEqual(await registry.contextInfoFor("cloud::model"), { tokens: 128000, source: "default" });
  assert.equal(await registry.contextWindowFor("missing"), 128000);
});

test("native API failures and invalid metadata do not prevent conversations", async (t) => {
  const registry = new ProviderRegistry({ id: "local", name: "Local", baseUrl: "http://localhost:1234/v1" });
  for (const response of [new Response(null, { status: 404 }), Response.json({ data: [] }),
    Response.json({ models: [{ key: "gemma", max_context_length: -1, loaded_instances: [] }] })]) {
    t.mock.method(globalThis, "fetch", async () => response);
    assert.equal(await registry.contextWindowFor("gemma"), 128000);
    t.mock.restoreAll();
  }
  t.mock.method(globalThis, "fetch", async () => { throw new Error("offline"); });
  assert.equal(await registry.contextWindowFor("gemma"), 128000);
});
