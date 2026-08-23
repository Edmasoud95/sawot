import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";

import { buildSystemPrompt, type Agent } from "./agent.js";

export const KOKORO_VOICES = [
  "af_heart", "af_alloy", "af_bella", "af_nicole", "af_nova", "af_sky",
  "am_adam", "am_michael", "am_onyx",
  "bf_emma", "bf_isabella", "bm_george", "bm_lewis",
];

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
    writeFileSync(this.path, JSON.stringify(data, null, 2));
  }
}

export interface SettingsState {
  model: string;
  voice: string;
  sassy: boolean;
}

export interface SettingsCtx {
  store: SettingsStore;
  agent: Agent;
  state: SettingsState;
  lmstudioUrl: string;
  summary: string;
  name: string;
  setSystemPrompt: (prompt: string) => void;
}

async function fetchModels(lmstudioUrl: string): Promise<string[]> {
  const resp = await fetch(lmstudioUrl + "/models");
  if (!resp.ok) throw new Error("LM Studio unreachable: " + resp.status);
  const data: any = await resp.json();
  return (data.data ?? []).map((m: any) => m.id);
}

export function registerSettingsRoutes(app: FastifyInstance, ctx: SettingsCtx): void {
  app.get("/api/settings", async () => {
    let models: string[] = [];
    let modelsError: string | undefined;
    try {
      models = await fetchModels(ctx.lmstudioUrl);
    } catch (e: any) {
      modelsError = String(e?.message ?? e);
    }
    const data: Record<string, any> = {
      model: ctx.state.model,
      voice: ctx.state.voice,
      sassy: ctx.state.sassy,
      models,
      voices: KOKORO_VOICES,
    };
    if (modelsError) data.models_error = modelsError;
    return data;
  });

  app.post("/api/settings", async (req: any, reply: any) => {
    const body = req.body ?? {};
    const model = body.model;
    const voice = body.voice;
    const sassy = body.sassy;

    if (voice !== undefined && !KOKORO_VOICES.includes(voice)) {
      return reply.code(400).send({ detail: "unknown voice: " + voice });
    }

    let models: string[] = [];
    if (model !== undefined) {
      try {
        models = await fetchModels(ctx.lmstudioUrl);
      } catch (e: any) {
        return reply.code(502).send({ detail: "LM Studio unreachable: " + e });
      }
      if (!models.includes(model)) {
        return reply.code(400).send({ detail: "unknown model: " + model });
      }
      ctx.agent.setModel(model);
      ctx.state.model = model;
    }
    if (voice !== undefined) ctx.state.voice = voice;
    if (sassy !== undefined) {
      ctx.state.sassy = Boolean(sassy);
      ctx.setSystemPrompt(buildSystemPrompt(ctx.summary, ctx.state.sassy, ctx.name));
    }

    ctx.store.save({ model: ctx.state.model, voice: ctx.state.voice, sassy: ctx.state.sassy });

    if (!models.length) {
      try {
        models = await fetchModels(ctx.lmstudioUrl);
      } catch (e: any) {
        return {
          model: ctx.state.model,
          voice: ctx.state.voice,
          sassy: ctx.state.sassy,
          models: [],
          voices: KOKORO_VOICES,
          models_error: String(e?.message ?? e),
        };
      }
    }
    return {
      model: ctx.state.model,
      voice: ctx.state.voice,
      sassy: ctx.state.sassy,
      models,
      voices: KOKORO_VOICES,
    };
  });
}
