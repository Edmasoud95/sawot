import { liveBackendPrompt } from "./liveTools.js";
import { DEFAULT_LIVE_PROMPT, DEFAULT_LIVE_BACKEND_PROMPT, LIVE_PROMPT_MAX, buildLivePrompt } from "./livePrompts.js";
import { normalizeHaUrl } from "./connections.js";
import { SettingsStore, CREDENTIAL_KEYS, type Credentials } from "./settingsStore.js";
export { SettingsStore } from "./settingsStore.js";
import type { FastifyInstance } from "fastify";

import { buildSystemPrompt, normalizePersonality, PERSONA, PERSONALITIES, PERSONALITY_PROMPT_MAX, type Agent, type Personality } from "./agent.js";
import { createChatCompletion } from "./reasoningFallback.js";
import type { InferenceClient } from "./inference.js";
import { probeEndpoint, qualifyModel, type ProviderRegistry } from "./providers.js";
import { isOpenAiSpeechProvider, OPENAI_SPEECH_MODELS, openAiVoices } from "./openaiSpeech.js";

/** Longest chat instructions accepted, in characters. */
export const CHAT_INSTRUCTIONS_MAX = 2000;

export const KOKORO_VOICES = [
  "af_heart", "af_alloy", "af_bella", "af_nicole", "af_nova", "af_sky",
  "am_adam", "am_michael", "am_onyx",
  "bf_emma", "bf_isabella", "bm_george", "bm_lewis",
];

/** The voice to use given what the active TTS engine offers. An empty list
 *  means the sidecar could not be asked, so the current setting stands. */
export function resolveVoice(voices: string[], current: string, fallback: string | null): string {
  if (!voices.length || voices.includes(current)) return current;
  return fallback ?? voices[0];
}

/** Live voice list from the sidecar, or Kokoro's curated list when it is down. */
async function activeVoices(ctx: SettingsCtx, providerId = ctx.state.ttsProviderId ?? "local", model = ctx.state.ttsModel ?? "gpt-4o-mini-tts"): Promise<{ engine: string | null; voices: string[]; default: string | null }> {
  if (providerId !== "local") return openAiVoices(model);
  try {
    const live = await (ctx.localInference ?? ctx.inference).voices();
    if (live.voices.length) return { engine: live.engine, voices: live.voices, default: live.default };
  } catch { /* sidecar offline */ }
  return { engine: null, voices: KOKORO_VOICES, default: KOKORO_VOICES[0] };
}

export interface SettingsState {
  liveVoiceEnabled?: boolean;
  liveVoicePrompt?: string;
  liveBackendPrompt?: string;
  ttsProviderId?: string;
  ttsModel?: string;
  model: string; // provider-qualified ("local::qwen3-8b")
  voice: string;
  personality: Personality;
  /** The custom personality text; kept even while sassy or plain is active. */
  personalityPrompt: string;
  detailedDrawings: boolean;
  /** Extra system-prompt instructions for Chat mode; blank means neutral. */
  chatInstructions: string;
}

export interface SettingsCtx {
  store: SettingsStore;
  agent: Agent;
  state: SettingsState;
  registry: ProviderRegistry;
  /** Qualified built-in model to fall back to when a provider is removed. */
  fallbackModel: string;
  summary: string;
  name: string;
  setSystemPrompt: (prompt: string) => void;
  inference: InferenceClient;
  localInference?: InferenceClient;
  onLiveVoiceDisabled?: () => Promise<void>;
  onCredentialsChanged?: (credentials: Credentials & { haUrl: string }) => void;
}

function refinePrompt(name: string): string {
  return `You write personality briefs for ${name}, a spoken smart-home voice assistant. ` +
    "A brief is a single paragraph of two to five sentences addressed to the assistant in the second person: " +
    "it names the character's traits, how it talks, and includes one or two short example lines in quotes. " +
    "It never changes what the assistant can do, never mentions tools or devices, and stays speakable out loud. " +
    "Here is the brief for the built-in sassy personality, as a model of the form:\n\n" + PERSONA.trim() + "\n\n" +
    "Reply with the brief only: no title, no preamble, no markdown, and do not start with \"You have personality:\".";
}

function persist(ctx: SettingsCtx): void {
  ctx.store.save({
    liveVoiceEnabled: ctx.state.liveVoiceEnabled === true,
    liveVoicePrompt: ctx.state.liveVoicePrompt ?? "",
    liveBackendPrompt: ctx.state.liveBackendPrompt ?? "",
    model: ctx.state.model,
    voice: ctx.state.voice,
    ttsProviderId: ctx.state.ttsProviderId ?? "local",
    ttsModel: ctx.state.ttsModel ?? "gpt-4o-mini-tts",
    personality: ctx.state.personality,
    personalityPrompt: ctx.state.personalityPrompt,
    chatInstructions: ctx.state.chatInstructions,
    detailedDrawings: ctx.state.detailedDrawings,
    providers: ctx.registry.customSpecs(),
  });
}

/** Settings payload: current values plus every provider with its last known
 *  model list, answered without waiting on any provider; the panel loads each
 *  provider's models on its own through /api/providers/:id/models. `models`
 *  is the flat provider-qualified list the pickers consume. */
async function settingsPayload(ctx: SettingsCtx): Promise<Record<string, any>> {
  const providers = ctx.registry.listing();
  const models = providers.flatMap((p) => p.models.map((m) => qualifyModel(p.id, m)));
  // Switching the TTS engine in Settings can leave a voice the new engine
  // does not know; fall back to its default and remember that.
  const selection = [ctx.state.ttsProviderId, ctx.state.ttsModel, ctx.state.voice];
  const active = await activeVoices(ctx);
  if (selection[0] !== ctx.state.ttsProviderId || selection[1] !== ctx.state.ttsModel || selection[2] !== ctx.state.voice) {
    return settingsPayload(ctx);
  }
  const voice = resolveVoice(active.voices, ctx.state.voice, active.default);
  if (voice !== ctx.state.voice) { ctx.state.voice = voice; persist(ctx); }
  const saved = ctx.store.load();
  const data: Record<string, any> = {
    liveVoiceEnabled: ctx.state.liveVoiceEnabled === true,
    liveVoicePrompt: ctx.state.liveVoicePrompt ?? "",
    liveBackendPrompt: ctx.state.liveBackendPrompt ?? "",
    ttsProviderId: ctx.state.ttsProviderId ?? "local",
    ttsModel: ctx.state.ttsModel ?? "gpt-4o-mini-tts",
    ttsModels: [...OPENAI_SPEECH_MODELS],
    ttsProviders: providers.filter(isOpenAiSpeechProvider),
    model: ctx.state.model,
    voice: ctx.state.voice,
    liveEffectiveBackendPrompt: liveBackendPrompt(buildSystemPrompt(ctx.summary, "plain", ctx.name), ctx.state.liveBackendPrompt),
    livePromptDefaults: { conversation: DEFAULT_LIVE_PROMPT, backend: DEFAULT_LIVE_BACKEND_PROMPT },
    liveEffectivePrompt: buildLivePrompt({ name: ctx.name, personality: ctx.state.personality, personalityPrompt: ctx.state.personalityPrompt,
      template: ctx.state.liveVoicePrompt, tools: true, search: Boolean(ctx.store.load().braveApiKey) }),
    personality: ctx.state.personality,
    personalityPrompt: ctx.state.personalityPrompt,
    chatInstructions: ctx.state.chatInstructions,
    detailedDrawings: ctx.state.detailedDrawings,
    haUrl: saved.haUrl ?? "",
    credentials: Object.fromEntries(CREDENTIAL_KEYS.map(key => [key, Boolean(saved[key])])),
    models,
    providers,
    voices: active.voices,
    // The active speech engine, so the panel can offer voice cloning only
    // where it works (Chatterbox).
    engine: active.engine,
  };
  const builtin = providers.find((p) => p.builtin);
  if (builtin?.error) data.models_error = builtin.error;
  return data;
}

export function registerSettingsRoutes(app: FastifyInstance, ctx: SettingsCtx): void {
  app.get("/api/settings", async () => settingsPayload(ctx));

  // One provider's models, fetched now with the registry's timeout. Slow or
  // unreachable providers answer with an error field so the others are never
  // held back.
  app.get("/api/providers/:pid/models", async (req: any, reply: any) => {
    const pid = req.params.pid;
    if (!ctx.registry.get(pid)) return reply.code(404).send({ detail: "unknown provider: " + pid });
    const listing = await ctx.registry.refresh(pid);
    return { id: pid, models: listing.models, effortLevels: listing.effortLevels ?? {}, imageInput: listing.imageInput ?? {}, ...(listing.error ? { error: listing.error } : {}) };
  });

  app.post("/api/settings", async (req: any, reply: any) => {
    const body = req.body ?? {};
    for (const key of ["liveVoicePrompt", "liveBackendPrompt"] as const) {
      if (body[key] !== undefined && (typeof body[key] !== "string" || body[key].length > LIVE_PROMPT_MAX)) {
        return reply.code(400).send({ detail: `Live instructions must be text of at most ${LIVE_PROMPT_MAX} characters.` });
      }
    }
    if (body.liveVoiceEnabled !== undefined && typeof body.liveVoiceEnabled !== "boolean") {
      return reply.code(400).send({ detail: "Live voice must be enabled or disabled." });
    }
    const credentials: Partial<Credentials> & { haUrl?: string } = {};
    if (Object.hasOwn(body, "haUrl")) {
      try { credentials.haUrl = normalizeHaUrl(body.haUrl); }
      catch (error) { return reply.code(400).send({ detail: (error as Error).message }); }
    }
    for (const key of CREDENTIAL_KEYS) {
      if (!Object.hasOwn(body, key)) continue;
      if (typeof body[key] !== "string" || body[key].length > 8192 || /[\x00-\x1f\x7f]/.test(body[key])) {
        return reply.code(400).send({ detail: key + " must be a single line of text, at most 8192 characters" });
      }
      credentials[key] = body[key].trim();
    }
    const model = body.model;
    const voice = body.voice;
    const speechRequested = body.ttsProviderId !== undefined || body.ttsModel !== undefined || voice !== undefined;
    const originalSpeech = [ctx.state.ttsProviderId, ctx.state.ttsModel, ctx.state.voice];
    const ttsProviderId = body.ttsProviderId === undefined ? ctx.state.ttsProviderId ?? "local" : body.ttsProviderId;
    const ttsModel = body.ttsModel === undefined ? ctx.state.ttsModel ?? "gpt-4o-mini-tts" : body.ttsModel;
    if (typeof ttsProviderId !== "string" || (ttsProviderId !== "local" &&
      (!ctx.registry.get(ttsProviderId) || !isOpenAiSpeechProvider(ctx.registry.get(ttsProviderId)!)))) {
      return reply.code(400).send({ detail: "Choose Local or a configured OpenAI provider for speech." });
    }
    if (!(OPENAI_SPEECH_MODELS as readonly unknown[]).includes(ttsModel)) {
      return reply.code(400).send({ detail: "Choose a supported OpenAI speech model." });
    }
    if (ttsProviderId !== "local" && !ctx.registry.get(ttsProviderId)?.apiKey) {
      return reply.code(400).send({ detail: "Add an API key to the OpenAI provider in Settings → Connections." });
    }
    // `sassy` is the pre-custom boolean; older clients may still send it.
    const personality = body.personality !== undefined || body.sassy !== undefined
      ? body.personality ?? (body.sassy ? "sassy" : "plain") : undefined;
    const personalityPrompt = body.personalityPrompt;
    const detailedDrawings = body.detailedDrawings;
    const chatInstructions = body.chatInstructions;

    if (personality !== undefined && !(PERSONALITIES as readonly string[]).includes(personality)) {
      return reply.code(400).send({ detail: "unknown personality: " + personality });
    }
    if (personalityPrompt !== undefined && (typeof personalityPrompt !== "string" || personalityPrompt.length > PERSONALITY_PROMPT_MAX)) {
      return reply.code(400).send({ detail: `personality prompt must be text of at most ${PERSONALITY_PROMPT_MAX} characters` });
    }
    if (chatInstructions !== undefined && (typeof chatInstructions !== "string" || chatInstructions.length > CHAT_INSTRUCTIONS_MAX)) {
      return reply.code(400).send({ detail: `chat instructions must be text of at most ${CHAT_INSTRUCTIONS_MAX} characters` });
    }

    const speechChanged = ttsProviderId !== (ctx.state.ttsProviderId ?? "local") || ttsModel !== (ctx.state.ttsModel ?? "gpt-4o-mini-tts");
    const voices = voice !== undefined || speechChanged ? await activeVoices(ctx, ttsProviderId, ttsModel) : null;
    if (voice !== undefined && !voices!.voices.includes(voice)) {
      return reply.code(400).send({ detail: "unknown voice: " + voice });
    }

    const resolved = model !== undefined ? ctx.registry.resolve(String(model)) : null;
    if (resolved) {
      let models: string[];
      try {
        models = await ctx.registry.modelsFor(resolved.providerId);
      } catch (e: any) {
        return reply.code(502).send({ detail: "provider unreachable: " + e });
      }
      if (!models.includes(resolved.model)) {
        return reply.code(400).send({ detail: "unknown model: " + model });
      }
    }
    // A slower save must not undo a newer speech selection or validate a voice
    // against an engine that has since changed.
    if (speechRequested && (originalSpeech[0] !== ctx.state.ttsProviderId ||
      originalSpeech[1] !== ctx.state.ttsModel || originalSpeech[2] !== ctx.state.voice)) {
      return reply.code(409).send({ detail: "Speech settings changed while saving. Please try again." });
    }
    if (resolved) {
      ctx.agent.setClient(resolved.client);
      ctx.agent.setModel(resolved.model);
      ctx.state.model = qualifyModel(resolved.providerId, resolved.model);
    }
    if (voice !== undefined) ctx.state.voice = voice;
    else if (voices) ctx.state.voice = resolveVoice(voices.voices, ctx.state.voice, voices.default);
    if (body.ttsProviderId !== undefined) ctx.state.ttsProviderId = ttsProviderId;
    if (body.ttsModel !== undefined) ctx.state.ttsModel = ttsModel;
    if (personality !== undefined || personalityPrompt !== undefined) {
      if (personality !== undefined) ctx.state.personality = normalizePersonality(personality);
      if (personalityPrompt !== undefined) ctx.state.personalityPrompt = personalityPrompt.trim();
      ctx.setSystemPrompt(buildSystemPrompt(ctx.summary, ctx.state.personality, ctx.name, ctx.state.personalityPrompt));
    }
    if (detailedDrawings !== undefined) {
      ctx.state.detailedDrawings = Boolean(detailedDrawings);
      ctx.agent.setDetailedDrawings(ctx.state.detailedDrawings);
    }
    if (chatInstructions !== undefined) ctx.state.chatInstructions = chatInstructions.trim();

    if (Object.keys(credentials).length) {
      ctx.store.save(credentials);
      const saved = ctx.store.load();
      ctx.onCredentialsChanged?.({ haUrl: saved.haUrl ?? "", haToken: saved.haToken ?? "", braveApiKey: saved.braveApiKey ?? "", hfToken: saved.hfToken ?? "" });
    }
    if (body.liveVoiceEnabled !== undefined) ctx.state.liveVoiceEnabled = body.liveVoiceEnabled;
    if (body.liveVoicePrompt !== undefined) ctx.state.liveVoicePrompt = body.liveVoicePrompt.trim();
    if (body.liveBackendPrompt !== undefined) ctx.state.liveBackendPrompt = body.liveBackendPrompt.trim();
    persist(ctx);
    if (body.liveVoiceEnabled === false) await ctx.onLiveVoiceDisabled?.();
    return settingsPayload(ctx);
  });

  // Turn a rough draft (or nothing) into a personality brief with the model
  // selected at the top of Settings. Nothing is applied until it is saved.
  app.post("/api/personality/refine", async (req: any, reply: any) => {
    const draft = String((req.body ?? {}).text ?? "").trim().slice(0, PERSONALITY_PROMPT_MAX);
    const resolved = ctx.registry.resolve(ctx.state.model);
    const task = draft
      ? "Rewrite these notes into the personality brief, keeping every trait and intent they express:\n\n" + draft
      : "Invent a distinctive, likeable personality for this assistant and write its brief.";
    try {
      const resp = await createChatCompletion<any>(resolved.client, {
        model: resolved.model,
        messages: [
          { role: "system", content: refinePrompt(ctx.name) },
          { role: "user", content: task },
        ],
      });
      // Models like to echo the example's opening; the prompt builder adds
      // its own lead-in, so drop it here.
      const text = String(resp.choices?.[0]?.message?.content ?? "").trim()
        .replace(/^"(.*)"$/s, "$1").replace(/^(?:your|you have) personality:\s*/i, "").trim();
      if (!text) return reply.code(502).send({ detail: "The model couldn't write a personality — try again." });
      return { text: text.slice(0, PERSONALITY_PROMPT_MAX) };
    } catch (e: any) {
      return reply.code(502).send({ detail: "Couldn't reach the model to refine the personality: " + String(e?.message ?? e) });
    }
  });

  app.post("/api/providers", async (req: any, reply: any) => {
    const body = req.body ?? {};
    const name = String(body.name ?? "").trim();
    const baseUrl = String(body.baseUrl ?? "").trim();
    const apiKey = body.apiKey ? String(body.apiKey) : undefined;

    if (!name) return reply.code(400).send({ detail: "provider name is required" });
    if (!/^https?:\/\//.test(baseUrl)) {
      return reply.code(400).send({ detail: "base URL must start with http:// or https://" });
    }

    // Reject endpoints we can't list models from — a working /models is the
    // contract every other part of the app relies on.
    let probed: string[];
    try {
      probed = await probeEndpoint(baseUrl, apiKey);
    } catch (e: any) {
      return reply.code(502).send({
        detail: "couldn't list models at " + baseUrl + "/models — " + String(e?.message ?? e),
      });
    }

    const added = ctx.registry.add(name, baseUrl, apiKey);
    ctx.registry.setModels(added.id, probed);
    persist(ctx);
    return settingsPayload(ctx);
  });

  app.delete("/api/providers/:pid", async (req: any, reply: any) => {
    const pid = req.params.pid;
    const spec = ctx.registry.get(pid);
    if (!spec) return reply.code(404).send({ detail: "unknown provider: " + pid });
    if (spec.builtin) {
      return reply.code(400).send({ detail: "the built-in provider can't be removed" });
    }

    if (ctx.state.ttsProviderId === pid) {
      return reply.code(409).send({ detail: "Switch speech to Local or another OpenAI provider in Settings → Speech before removing this provider." });
    }

    const wasActive = ctx.registry.resolve(ctx.state.model).providerId === pid;
    ctx.registry.remove(pid);
    // If the active model lived on the removed provider, fall back to the
    // built-in provider's configured model.
    if (wasActive) {
      ctx.state.model = ctx.fallbackModel;
      const resolved = ctx.registry.resolve(ctx.state.model);
      ctx.agent.setClient(resolved.client);
      ctx.agent.setModel(resolved.model);
    }
    persist(ctx);
    return settingsPayload(ctx);
  });
}
