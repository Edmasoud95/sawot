import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { ProviderRegistry, probeEndpoint } from "../src/providers.js";

// A provider that accepts the connection and never answers, like a sleeping
// LM Studio host, next to one that answers at once.
function servers() {
  const hanging = createServer(() => { /* never respond */ });
  const healthy = createServer((_req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ data: [{ id: "deepseek-v4" }] })); });
  return Promise.all([hanging, healthy].map((s) => new Promise<number>((resolve) => s.listen(0, () => resolve((s.address() as any).port))))).then(([h, k]) => ({
    hangingUrl: `http://127.0.0.1:${h}/v1`, healthyUrl: `http://127.0.0.1:${k}/v1`, close: () => { hanging.closeAllConnections?.(); hanging.close(); healthy.close(); },
  }));
}

test("an unresponsive provider times out quickly and the others still list their models", async () => {
  const s = await servers();
  try {
    const registry = new ProviderRegistry(
      { id: "lm-studio", name: "LM Studio", baseUrl: s.hangingUrl, builtin: true },
      [{ id: "deepseek", name: "DeepSeek", baseUrl: s.healthyUrl, apiKey: "k" }],
      { timeoutMs: 300 },
    );
    const t = Date.now();
    const listed = await registry.listAllModels();
    assert.ok(Date.now() - t < 1500, `listing must not wait on the hung provider (took ${Date.now() - t} ms)`);
    const byId = Object.fromEntries(listed.map((p) => [p.id, p]));
    assert.deepEqual(byId.deepseek.models, ["deepseek-v4"]);
    assert.equal(byId["lm-studio"].models.length, 0);
    assert.match(byId["lm-studio"].error ?? "", /timed out/i);
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
