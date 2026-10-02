import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { ProviderRegistry } from "../src/providers.js";
import { registerLiveVoiceRoutes } from "../src/liveVoice.js";

const origin = "https://sawot.test";
const id = "0123456789abcdef0123456789abcdef";
function harness(fetcher: typeof fetch, now = () => Date.now(), enabled = () => true, createAgent?: any) {
  const app = Fastify();
  const registry = new ProviderRegistry({ id: "local", name: "Local", baseUrl: "http://local/v1" }, [
    { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", apiKey: "private-test-key" },
    { id: "other", name: "Other", baseUrl: "https://example.com/v1", apiKey: "other-key" },
  ]);
  const service = registerLiveVoiceRoutes(app, { registry, allowedOrigins: [origin], fetch: fetcher, now, enabled, createAgent });
  const post = (url: string, payload: any = {}) => app.inject({ method: "POST", url, headers: { origin }, payload });
  return { app, post, service };
}
const offer = { id, providerId: "openai", voice: "marin", sdp: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n" };
const created = () => Response.json({ session: { id: "live_test" }, transport: { type: "webrtc", sdp: "answer" }, secret: "never forward" });

test("Live setup reuses a configured key, exposes only the answer, and closes the paid session", async () => {
  const calls: { url: string; body: any }[] = [];
  const { app, post } = harness((async (url, init) => {
    assert.equal(new Headers(init!.headers).get("Authorization"), "Bearer private-test-key");
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    return String(url).endsWith("hangup") ? new Response(null, { status: 200 }) : created();
  }) as typeof fetch);
  try {
    const config = (await app.inject("/api/live/config")).json();
    assert.deepEqual(config.providers, [{ id: "openai", name: "OpenAI" }]);
    assert.equal(config.inactivityMs, 30_000);
    const response = await post("/api/live/sessions", offer);
    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.json(), { id, sdp: "answer" });
    assert.equal(calls[0].url, "https://api.openai.com/v1/live/sessions");
    assert.equal(calls[0].body.session.model, "gpt-live-1");
    assert.equal(calls[0].body.session.store, false);
    assert.deepEqual(calls[0].body.session.delegation, { type: "client" });
    assert.match(calls[0].body.session.instructions, /No tool backend is connected/i);
    assert.equal((await post(`/api/live/sessions/${id}/close`)).statusCode, 200);
    assert.equal(calls[1].url, "https://api.openai.com/v1/live/sessions/live_test/hangup");
  } finally { await app.close(); }
});

test("the feature flag blocks new sessions and disabling it closes active sessions", async () => {
  let enabled = false;
  let calls = 0;
  const { app, post, service } = harness((async (url) => {
    calls++;
    return String(url).endsWith("hangup") ? new Response(null, { status: 200 }) : created();
  }) as typeof fetch, () => 0, () => enabled);
  try {
    assert.equal((await app.inject("/api/live/config")).json().enabled, false);
    assert.equal((await post("/api/live/sessions", offer)).statusCode, 403);
    assert.equal(calls, 0);
    enabled = true;
    assert.equal((await post("/api/live/sessions", offer)).statusCode, 201);
    enabled = false;
    await service.sweep();
    assert.equal(calls, 2);
    assert.equal((await post(`/api/live/sessions/${id}/heartbeat`)).statusCode, 404);
  } finally { await app.close(); }
});

test("Live rejects untrusted origins, invalid voices and unsupported providers before any API call", async () => {
  let calls = 0;
  const { app, post } = harness((async () => { calls++; return created(); }) as typeof fetch);
  try {
    assert.equal((await app.inject({ method: "POST", url: "/api/live/sessions", payload: offer })).statusCode, 403);
    for (const patch of [{ providerId: "other" }, { voice: "af_heart" }, { sdp: "" }, { id: "../bad" }, { sdp: "x".repeat(70_000) }]) {
      assert.ok((await post("/api/live/sessions", { ...offer, ...patch })).statusCode >= 400);
    }
    assert.equal(calls, 0);
  } finally { await app.close(); }
});

test("a closed browser during startup cannot leave a newly-created Live session running", async () => {
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  let closes = 0;
  const { app, post } = harness((async (url) => {
    if (String(url).endsWith("hangup")) { closes++; return new Response(null, { status: 200 }); }
    started(); await new Promise<void>(resolve => { release = resolve; }); return created();
  }) as typeof fetch);
  try {
    const pending = post("/api/live/sessions", offer).then(r => r);
    await ready;
    await post(`/api/live/sessions/${id}/close`);
    release();
    assert.equal((await pending).statusCode, 409);
    assert.equal(closes, 1);
  } finally { await app.close(); }
});

test("the server closes abandoned sessions and does not leak upstream error text", async () => {
  let now = 0;
  let closes = 0;
  let fail = false;
  const { app, post, service } = harness((async (url) => {
    if (String(url).endsWith("hangup")) { closes++; return new Response(null, { status: 200 }); }
    return fail ? Response.json({ error: { message: "private-test-key" } }, { status: 403 }) : created();
  }) as typeof fetch, () => now);
  try {
    await post("/api/live/sessions", offer);
    now = 10_000;
    assert.equal((await post(`/api/live/sessions/${id}/heartbeat`)).statusCode, 200);
    now = 20_000; await service.sweep(); assert.equal(closes, 0);
    now = 26_000; await service.sweep(); assert.equal(closes, 1);
    fail = true;
    const response = await post("/api/live/sessions", offer);
    assert.equal(response.statusCode, 403);
    assert.ok(!response.body.includes("private-test-key"));
  } finally { await app.close(); }
});

test("failed remote closure is retained and retried by the server watchdog", async () => {
  let closes = 0;
  const { app, post, service } = harness((async (url) => {
    if (!String(url).endsWith("hangup")) return created();
    closes++;
    return new Response(null, { status: closes === 1 ? 503 : 200 });
  }) as typeof fetch);
  try {
    await post("/api/live/sessions", offer);
    assert.equal((await post(`/api/live/sessions/${id}/close`)).statusCode, 502);
    assert.equal((await post(`/api/live/sessions/${id}/heartbeat`)).statusCode, 404);
    await service.sweep();
    assert.equal(closes, 2);
    await service.sweep();
    assert.equal(closes, 2);
  } finally { await app.close(); }
});

test('Live task endpoint validates context, deduplicates work, and blocks tasks after disable', async () => {
  let enabled = true;
  let runs = 0;
  const { app, post, service } = harness((async url => String(url).endsWith('hangup') ? new Response(null, { status: 200 }) : created()) as typeof fetch,
    () => 0, () => enabled, () => ({ run: async () => { runs++; return 'Verified test result'; } }));
  const task = { delegationId: 'item_test', turns: [{ role: 'user', text: 'Test lookup', start: 0, end: 500 }] };
  try {
    const url = `/api/live/sessions/${id}/delegate`;
    assert.equal((await post(url, task)).statusCode, 409);
    await post('/api/live/sessions', offer);
    assert.equal((await app.inject({ method: 'POST', url, payload: task })).statusCode, 403);
    assert.equal((await post(url, { ...task, turns: [{ role: 'system', text: 'bad', start: 0, end: 1 }] })).statusCode, 400);
    const first = await post(url, task);
    assert.equal(first.statusCode, 200);
    assert.equal(first.json().content, 'Verified test result');
    assert.deepEqual((await post(url, task)).json(), first.json());
    assert.equal(runs, 1);
    enabled = false;
    await service.sweep();
    assert.equal((await post(url, { ...task, delegationId: 'item_next' })).statusCode, 409);
    assert.equal(runs, 1);
  } finally { await app.close(); }
});
