import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";

import { buildSystemPrompt, type Agent } from "./agent.js";
import type { InferenceClient } from "./inference.js";
import { probeEndpoint, qualifyModel, type ProviderRegistry } from "./providers.js";

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
async function activeVoices(ctx: SettingsCtx): Promise<{ voices: string[]; default: string | null }> {
  try {
    const live = await ctx.inference.voices();
    if (live.voices.length) return { voices: live.voices, default: live.default };
  } catch { /* sidecar offline */ }
  return { voices: KOKORO_VOICES, default: KOKORO_VOICES[0] };
}

export class SettingsStore {
  constructor(private path: string) {}

  load(): Record<string, any> {
    try {
      if (existsSync(this.path)) return JSON.parse(readFileSync(this.path, "utf8"));
    } catch {
      /* corrupt file => empty */
    }
    return {};
  }

  save(data: Record<string, any>): void {
    // Merge over what's on disk — the Python sidecar keeps its own keys
    // (e.g. stt_model) in the same file.
    writeFileSync(this.path, JSON.stringify({ ...this.load(), ...data }, null, 2));
  }
}

export interface SettingsState {
  model: string; // provider-qualified ("local::qwen3-8b")
  voice: string;
  sassy: boolean;
  detailedDrawings: boolean;
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
}

function persist(ctx: SettingsCtx): void {
  ctx.store.save({
    model: ctx.state.model,
    voice: ctx.state.voice,
    sassy: ctx.state.sassy,
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
  const active = await activeVoices(ctx);
  const voice = resolveVoice(active.voices, ctx.state.voice, active.default);
  if (voice !== ctx.state.voice) { ctx.state.voice = voice; persist(ctx); }
  const data: Record<string, any> = {
    model: ctx.state.model,
    voice: ctx.state.voice,
    sassy: ctx.state.sassy,
    detailedDrawings: ctx.state.detailedDrawings,
    models,
    providers,
    voices: active.voices,
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
    return { id: pid, models: listing.models, ...(listing.error ? { error: listing.error } : {}) };
  });

  app.post("/api/settings", async (req: any, reply: any) => {
    const body = req.body ?? {};
    const model = body.model;
    const voice = body.voice;
    const sassy = body.sassy;
    const detailedDrawings = body.detailedDrawings;

    if (voice !== undefined && !(await activeVoices(ctx)).voices.includes(voice)) {
      return reply.code(400).send({ detail: "unknown voice: " + voice });
    }

    if (model !== undefined) {
      const resolved = ctx.registry.resolve(String(model));
      let models: string[];
      try {
        models = await ctx.registry.modelsFor(resolved.providerId);
      } catch (e: any) {
        return reply.code(502).send({ detail: "provider unreachable: " + e });
      }
      if (!models.includes(resolved.model)) {
        return reply.code(400).send({ detail: "unknown model: " + model });
      }
      ctx.agent.setClient(resolved.client);
      ctx.agent.setModel(resolved.model);
      ctx.state.model = qualifyModel(resolved.providerId, resolved.model);
    }
    if (voice !== undefined) ctx.state.voice = voice;
    if (sassy !== undefined) {
      ctx.state.sassy = Boolean(sassy);
      ctx.setSystemPrompt(buildSystemPrompt(ctx.summary, ctx.state.sassy, ctx.name));
    }
    if (detailedDrawings !== undefined) {
      ctx.state.detailedDrawings = Boolean(detailedDrawings);
      ctx.agent.setDetailedDrawings(ctx.state.detailedDrawings);
    }

    persist(ctx);
    return settingsPayload(ctx);
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
