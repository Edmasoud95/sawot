import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import Fastify from "fastify";
import { ProviderRegistry } from "../src/providers.js";
import { registerSettingsRoutes } from "../src/settings.js";

function servers() {
  const hanging = createServer(() => { /* never respond */ });
  const healthy = createServer((_req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ data: [{ id: "deepseek-v4" }] })); });
  return Promise.all([hanging, healthy].map((s) => new Promise<number>((resolve) => s.listen(0, () => resolve((s.address() as any).port))))).then(([h, k]) => ({
    hangingUrl: `http://127.0.0.1:${h}/v1`, healthyUrl: `http://127.0.0.1:${k}/v1`, close: () => { hanging.closeAllConnections?.(); hanging.close(); healthy.close(); },
  }));
}

async function harness(s: Awaited<ReturnType<typeof servers>>) {
  const registry = new ProviderRegistry(
    { id: "lm-studio", name: "LM Studio", baseUrl: s.hangingUrl, builtin: true },
    [{ id: "deepseek", name: "DeepSeek", baseUrl: s.healthyUrl, apiKey: "k" }],
    { timeoutMs: 300 },
  );
  const app = Fastify();
  registerSettingsRoutes(app, {
    store: { load: () => ({}), save: () => {} } as any,
    agent: { setClient() {}, setModel() {}, setDetailedDrawings() {} } as any,
    state: { model: "deepseek::deepseek-v4", voice: "af_heart", sassy: false, detailedDrawings: false } as any,
    registry, fallbackModel: "lm-studio::x", summary: "", name: "Rita", setSystemPrompt() {},
    inference: { voices: async () => ({ engine: "kokoro", voices: ["af_heart"], default: "af_heart" }) } as any,
  });
  await app.ready();
  return { app, registry };
}

test("settings answer at once with each provider's last known models instead of waiting on a hung provider", async () => {
  const s = await servers();
  const { app } = await harness(s);
  try {
    const t = Date.now();
    const res = await app.inject({ method: "GET", url: "/api/settings" });
    assert.equal(res.statusCode, 200);
    assert.ok(Date.now() - t < 250, `settings must not wait for model lists (took ${Date.now() - t} ms)`);
    const providers = res.json().providers;
    assert.deepEqual(providers.map((p: any) => [p.id, p.state]), [["lm-studio", "pending"], ["deepseek", "pending"]]);
  } finally { await app.close(); s.close(); }
});

test("each provider's models load through their own route, and settings then carry the cached list", async () => {
  const s = await servers();
  const { app } = await harness(s);
  try {
    const ok = await app.inject({ method: "GET", url: "/api/providers/deepseek/models" });
    assert.equal(ok.statusCode, 200);
    assert.deepEqual(ok.json(), { id: "deepseek", models: ["deepseek-v4"] });
    const t = Date.now();
    const hung = await app.inject({ method: "GET", url: "/api/providers/lm-studio/models" });
    assert.equal(hung.statusCode, 200, "an unreachable provider is a result, not a failure");
    assert.equal(hung.json().models.length, 0);
    assert.match(hung.json().error, /timed out/);
    assert.ok(Date.now() - t < 1500);
    assert.equal((await app.inject({ method: "GET", url: "/api/providers/nope/models" })).statusCode, 404);

    const settings = (await app.inject({ method: "GET", url: "/api/settings" })).json();
    const byId = Object.fromEntries(settings.providers.map((p: any) => [p.id, p]));
    assert.deepEqual(byId.deepseek.models, ["deepseek-v4"]);
    assert.equal(byId.deepseek.state, "ready");
    assert.equal(byId["lm-studio"].state, "error");
    assert.deepEqual(settings.models, ["deepseek::deepseek-v4"]);
  } finally { await app.close(); s.close(); }
});
