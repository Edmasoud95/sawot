import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InferenceClient, InferenceError } from "../src/inference.js";
import { registerSettingsRoutes, SettingsStore } from "../src/settings.js";
import { ProviderRegistry } from "../src/providers.js";
import { runVoiceTurn } from "../src/pipeline.js";
import { ChatStore } from "../src/chat.js";
import { registerChatRoutes } from "../src/chatRoutes.js";

const remote = { baseUrl: "https://api.openai.com/v1", apiKey: "test-only-key", model: "gpt-4o-mini-tts" };

test("OpenAI speech uses authenticated WAV requests while transcription stays local", async () => {
  const original = globalThis.fetch;
  const requests: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url, init) => {
    requests.push({ url: String(url), init: init! });
    return String(url).endsWith("transcriptions")
      ? Response.json({ text: "hello" }) : new Response("wav-audio");
  }) as typeof fetch;
  try {
    const client = new InferenceClient("http://sidecar", () => remote);
    assert.equal(await client.transcribe(Buffer.from("mic")), "hello");
    assert.equal((await client.synthesize("Hello", "coral")).toString(), "wav-audio");
    assert.equal(requests[0].url, "http://sidecar/v1/audio/transcriptions");
    assert.equal(requests[1].url, "https://api.openai.com/v1/audio/speech");
    assert.equal(new Headers(requests[1].init.headers).get("Authorization"), "Bearer test-only-key");
    assert.deepEqual(JSON.parse(String(requests[1].init.body)), {
      model: "gpt-4o-mini-tts", input: "Hello", voice: "coral", response_format: "wav",
    });
    assert.equal((await client.voices()).engine, "openai");
    assert.ok((await client.voices()).voices.includes("marin"));
    assert.equal(requests.length, 2, "remote voices must not depend on the sidecar");
  } finally { globalThis.fetch = original; }
});

test("remote speech rejects oversized input and unsupported voices before sending text", async () => {
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => { calls++; return new Response("wav"); }) as typeof fetch;
  try {
    const client = new InferenceClient("http://sidecar", () => remote);
    await assert.rejects(client.synthesize("x".repeat(4097), "coral"), /4096/);
    await assert.rejects(client.synthesize("hello", "af_heart"), /voice/i);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test("OpenAI failures have actionable messages without echoing provider response secrets", async () => {
  const original = globalThis.fetch;
  try {
    for (const [status, message] of [[401, /API key/], [429, /quota|rate limit/], [500, /unavailable/]] as const) {
      globalThis.fetch = (async () => Response.json({ error: { message: "test-only-key" } }, { status })) as typeof fetch;
      await assert.rejects(new InferenceClient("http://sidecar", () => remote).synthesize("hello", "coral"), (e: any) => {
        assert.ok(e instanceof InferenceError);
        assert.match(e.detail!, message);
        assert.ok(!e.message.includes("test-only-key"));
        return true;
      });
    }
  } finally { globalThis.fetch = original; }
});

test("speech requests honour cancellation and snapshots keep a turn on its original provider", async () => {
  const original = globalThis.fetch;
  let selected: typeof remote | undefined = remote;
  let called = "";
  globalThis.fetch = (async (url, init) => {
    called = String(url);
    init?.signal?.throwIfAborted();
    return new Response("wav");
  }) as typeof fetch;
  try {
    const client = new InferenceClient("http://sidecar", () => selected);
    const turn = client.snapshot();
    selected = undefined;
    await turn.synthesize("hello", "coral");
    assert.equal(called, "https://api.openai.com/v1/audio/speech");
    await assert.rejects(turn.synthesize("hello", "coral", AbortSignal.abort()), { name: "AbortError" });
    await client.synthesize("hello", "af_heart");
    assert.equal(called, "http://sidecar/v1/audio/speech");
  } finally { globalThis.fetch = original; }
});

test("cancelling pending speech reaches the HTTP request and timeouts give a safe error", async () => {
  const original = globalThis.fetch;
  const originalTimeout = AbortSignal.timeout;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  globalThis.fetch = (async (_url, init) => {
    started();
    const signal = init!.signal!;
    signal.throwIfAborted();
    return new Promise<Response>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  }) as typeof fetch;
  try {
    const client = new InferenceClient("http://sidecar", () => remote);
    const controller = new AbortController();
    const pending = client.synthesize("hello", "coral", controller.signal);
    await ready;
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    AbortSignal.timeout = () => AbortSignal.abort(new DOMException("timeout", "TimeoutError"));
    await assert.rejects(client.synthesize("hello", "coral"), /timed out/);
    await assert.rejects(new InferenceClient("http://sidecar", () => ({ ...remote, apiKey: "" })).synthesize("hello", "coral"), /API key/);
  } finally { globalThis.fetch = original; AbortSignal.timeout = originalTimeout; }
});

test("voice replies and chat read-aloud use OpenAI audio without hidden speech tags", async () => {
  const original = globalThis.fetch;
  const inputs: string[] = [];
  globalThis.fetch = (async (url, init) => {
    if (String(url).endsWith("transcriptions")) return Response.json({ text: "hello" });
    assert.equal(String(url), "https://api.openai.com/v1/audio/speech");
    inputs.push(JSON.parse(String(init!.body)).input);
    return new Response("WAV-fixture");
  }) as typeof fetch;
  const dir = mkdtempSync(join(tmpdir(), "sawot-speech-flows-"));
  const app = Fastify();
  try {
    const inference = new InferenceClient("http://sidecar", () => remote);
    const events: { type: string; data: any }[] = [];
    await runVoiceTurn(inference.snapshot(), { run: async (_history: any, _text: any, onEvent: any, options: any) => {
      assert.equal(options.speechEngine, "openai");
      await onEvent("expression", { shape: "happy" });
      return "Hello [laugh] there.";
    } } as any, Buffer.from("mic"), [], (type, data) => { events.push({ type, data }); }, "coral");
    assert.equal(events.find(e => e.type === "wav")?.data.toString(), "WAV-fixture");
    assert.deepEqual(events.slice(-2).map(e => e.type), ["expression", "wav"]);
    registerChatRoutes(app, { store: new ChatStore(dir), uploadDir: dir,
      synthesize: (text: string, signal: AbortSignal) => inference.synthesize(text, "coral", signal) } as any);
    const response = await app.inject({ method: "POST", url: "/api/chat/speech", payload: { text: "<expression:happy>Hello [laugh] there." } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body, "WAV-fixture");
    assert.deepEqual(inputs, ["Hello there.", "Hello there."]);
    globalThis.fetch = (async () => new Response(null, { status: 401 })) as typeof fetch;
    const failed = await app.inject({ method: "POST", url: "/api/chat/speech", payload: { text: "hello" } });
    assert.equal(failed.statusCode, 502);
    assert.match(failed.json().detail, /API key/);
  } finally { await app.close(); globalThis.fetch = original; rmSync(dir, { recursive: true, force: true }); }
});

test("settings persist independent speech selection, validate atomically, and protect active providers", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sawot-speech-"));
  const store = new SettingsStore(join(dir, "settings.json"));
  const registry = new ProviderRegistry({ id: "local", name: "Local", baseUrl: "http://sidecar/v1", builtin: true }, [
    { id: "openai", name: "OpenAI", ...remote },
    { id: "other", name: "Other", baseUrl: "https://example.com/v1" },
  ]);
  const state: any = { model: "local::chat", voice: "af_heart", personality: "plain", personalityPrompt: "", detailedDrawings: false, chatInstructions: "" };
  const app = Fastify();
  let liveDisabled = 0;
  registerSettingsRoutes(app, { onLiveVoiceDisabled: async () => { liveDisabled++; }, store, registry, state, agent: { setClient() {}, setModel() {} } as any, fallbackModel: "local::chat", summary: "", name: "SAWOT", setSystemPrompt() {},
    inference: { voices: async () => ({ engine: "kokoro", voices: ["af_heart"], default: "af_heart" }) } as any });
  const save = (payload: any) => app.inject({ method: "POST", url: "/api/settings", payload });
  try {
    const initial = (await app.inject("/api/settings")).json();
    assert.equal(initial.liveVoiceEnabled, false);
    assert.equal((await save({ liveVoiceEnabled: "true" })).statusCode, 400);
    assert.equal((await save({ liveVoiceEnabled: true })).json().liveVoiceEnabled, true);
    assert.equal(store.load().liveVoiceEnabled, true);
    assert.equal((await save({ liveVoiceEnabled: false })).json().liveVoiceEnabled, false);
    assert.equal(store.load().liveVoiceEnabled, false);
    assert.equal(liveDisabled, 1);
    assert.deepEqual(initial.ttsProviders.map((p: any) => p.id), ["openai"]);
    const result = await save({ ttsProviderId: "openai", ttsModel: "gpt-4o-mini-tts", voice: "marin" });
    assert.equal(result.statusCode, 200);
    assert.equal(result.json().model, "local::chat");
    assert.equal(result.json().engine, "openai");
    assert.equal(result.json().voice, "marin");
    assert.ok(!result.body.includes("test-only-key"));
    assert.equal(store.load().ttsProviderId, "openai");
    assert.equal(store.load().ttsModel, "gpt-4o-mini-tts");
    for (const patch of [{ ttsProviderId: "other" }, { ttsProviderId: "missing" }, { ttsModel: "chat-model" }, { ttsModel: "tts-1", voice: "marin" }, { ttsProviderId: null }]) {
      assert.equal((await save(patch)).statusCode, 400);
      assert.equal(state.ttsProviderId, "openai");
      assert.equal(state.voice, "marin");
    }
    assert.equal((await app.inject({ method: "DELETE", url: "/api/providers/openai" })).statusCode, 409);
    assert.equal((await save({ ttsModel: "tts-1" })).json().voice, "alloy");
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>(resolve => { started = resolve; });
    registry.modelsFor = async () => { started(); await new Promise<void>(resolve => { release = resolve; }); return ["other-chat"]; };
    // A model refresh can take seconds; it must not restore a stale TTS selection.
    const modelSave = save({ model: "local::other-chat" });
    const pendingModel = modelSave.then(result => result);
    await waiting;
    const local = await save({ ttsProviderId: "local" });
    assert.equal(local.json().voice, "af_heart");
    assert.equal(local.json().engine, "kokoro");
    release();
    assert.equal((await pendingModel).statusCode, 200);
    assert.equal(state.ttsProviderId, "local");
    assert.equal(state.voice, "af_heart");
    assert.equal((await app.inject({ method: "DELETE", url: "/api/providers/openai" })).statusCode, 200);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
