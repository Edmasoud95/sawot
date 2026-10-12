import { randomUUID } from "node:crypto";
import { beginVoiceMemory, guardVoicePrivacy, privateProviderGuard, VoiceMemoryError, type VoiceMemorySession } from "./memory/voice.js";
import { createControlHandler } from "./controls.js";
import { buildLivePrompt } from "./livePrompts.js";
import { liveBackendPrompt } from "./liveTools.js";
import { PushNotifications } from "./pushNotifications.js";
import { registerPushRoutes } from "./pushRoutes.js";
import { RunnerClient } from "./analysis/runnerClient.js";
import { AnalysisFileStore } from "./analysis/fileStore.js";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import Fastify from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { WebSocketServer } from "ws";
import proxy from "@fastify/http-proxy";

import { Agent, buildSystemPrompt, normalizePersonality } from "./agent.js";
import { registerVoiceRoutes } from "./voiceRoutes.js";
import { registerDictationRoutes } from "./dictationRoutes.js";
import { ChatStore } from "./chat.js";
import { MemoryStore } from "./memory/store.js";
import { registerMemoryRoutes } from "./memory/routes.js";
import { registerChatRoutes, type ChatCtx } from "./chatRoutes.js";
import { BraveSearchClient, buildSearchTools } from "./search.js";
import { loadConfig } from "./config.js";
import { HomeAssistant } from "./ha.js";
import { InferenceClient, InferenceError } from "./inference.js";
import { isOpenAiSpeechProvider } from "./openaiSpeech.js";
import { registerLiveVoiceRoutes } from "./liveVoice.js";
import { VoiceSession } from "./voiceSession.js";
import { isAllowedVoiceOrigin } from "./voiceOrigin.js";
import { runVoiceTurn } from "./pipeline.js";
import { loadVoiceImages } from "./voiceImages.js";
import { ProviderRegistry, qualifyModel } from "./providers.js";
import { registerSettingsRoutes, SettingsStore, type SettingsState } from "./settings.js";
import { buildHaTools } from "./tools.js";
import { ResourceMonitor } from "./resources.js";

const DEFAULT_ALLOWED_CONTROLS: Record<string, string[]> = {
  light: ["turn_on", "turn_off"],
  switch: ["turn_on", "turn_off"],
  media_player: ["turn_on", "turn_off"],
  climate: ["set_temperature"],
};

function repoRoot(): string {
  for (const c of [".", "..", "../.."]) {
    if (existsSync(join(c, "config.yaml"))) return resolve(c);
  }
  return resolve(".");
}

async function main() {
  const config = loadConfig();
  const root = repoRoot();
  const dataDir = config.dataDir;
  mkdirSync(join(dataDir, "data"), { recursive: true });
  Agent.replyLogPath = join(dataDir, "data", "orb-replies.log");
  const https = config.sslCertfile && config.sslKeyfile
    ? {
        key: readFileSync(resolve(dataDir, config.sslKeyfile)),
        cert: readFileSync(resolve(dataDir, config.sslCertfile)),
      }
    : undefined;
  // Fastify serves HTTPS when `https` is passed at construction; its types
  // mis-infer HTTP/2 here, so type the instance loosely (runtime is HTTPS).
  const app: any = Fastify((https ? { https } : {}) as any);

  app.register(multipart, { limits: { fileSize: 11 * 1024 * 1024 } });
  app.register(proxy, { upstream: config.sidecarUrl, prefix: "/v1/audio", rewritePrefix: "/v1/audio" });
  app.register(proxy, { upstream: config.sidecarUrl, prefix: "/v1/models", rewritePrefix: "/v1/models" });
  app.register(proxy, { upstream: config.sidecarUrl, prefix: "/api/models", rewritePrefix: "/api/models" });
  // Voice cloning lives in the sidecar (it owns models/tts/voices/); the
  // upload is relayed rather than proxied, see voiceRoutes.ts.
  registerVoiceRoutes(app, config.sidecarUrl);
  registerDictationRoutes(app, config.sidecarUrl);

  const localInference = new InferenceClient(config.sidecarUrl);
  const ha = new HomeAssistant(config.haUrl, config.haToken);
  const handleControl = createControlHandler(ha, config.allowedControls ?? DEFAULT_ALLOWED_CONTROLS);
  const tools = buildHaTools(ha);
  const searchTools = config.braveApiKey
    ? buildSearchTools(new BraveSearchClient(config.braveApiKey))
    : [];

  const store = new SettingsStore(join(dataDir, "settings.json"));
  const overrides = store.load();
  const registry = new ProviderRegistry(
    { id: "local", name: "Local server", baseUrl: config.llmUrl, builtin: true, privateMemoryAccess: overrides.localPrivateMemoryAccess === true },
    Array.isArray(overrides.providers) ? overrides.providers : [],
  );
  // Warm every provider's model list in the background so pickers have
  // something at once; a sleeping provider only delays its own entry.
  void registry.listAllModels().catch(() => {});
  const fallbackModel = qualifyModel(registry.defaultId, config.llmModel);
  const initial = registry.resolve(overrides.model ?? fallbackModel);
  const state: SettingsState = {
    liveVoiceEnabled: overrides.liveVoiceEnabled === true,
    liveVoicePrompt: typeof overrides.liveVoicePrompt === "string" ? overrides.liveVoicePrompt : "",
    liveBackendPrompt: typeof overrides.liveBackendPrompt === "string" ? overrides.liveBackendPrompt : "",
    ttsProviderId: overrides.ttsProviderId ?? "local",
    ttsModel: overrides.ttsModel ?? "gpt-4o-mini-tts",
    model: qualifyModel(initial.providerId, initial.model),
    voice: overrides.voice ?? config.ttsVoice,
    personality: overrides.personality !== undefined || overrides.sassy !== undefined
      ? normalizePersonality(overrides.personality, overrides.sassy)
      : config.assistantPersonality,
    personalityPrompt: String(overrides.personalityPrompt ?? config.assistantPersonalityPrompt ?? ""),
    detailedDrawings: Boolean(overrides.detailedDrawings ?? false),
    chatInstructions: String(overrides.chatInstructions ?? "").trim().slice(0, 2000),
  };
  const inference = new InferenceClient(config.sidecarUrl, () => {
    if (!state.ttsProviderId || state.ttsProviderId === "local") return undefined;
    const provider = registry.get(state.ttsProviderId);
    if (!provider || !isOpenAiSpeechProvider(provider)) {
      throw new InferenceError(400, "Select an available speech provider in Settings → Speech.", "synthesize");
    }
    return { baseUrl: provider.baseUrl, apiKey: provider.apiKey ?? "", model: state.ttsModel ?? "gpt-4o-mini-tts" };
  });

  let summary = "";
  let systemPrompt = buildSystemPrompt(summary, state.personality, config.assistantName, state.personalityPrompt);
  const agent = new Agent(initial.client, initial.model, [...tools, ...searchTools], systemPrompt);
  agent.setDetailedDrawings(state.detailedDrawings);

  const setSystemPrompt = (prompt: string) => {
    systemPrompt = prompt;
    agent.setSystemPrompt(prompt);
  };

  try {
    await ha.loadAreas();
    summary = await ha.entitySummary();
  } catch {
    summary = "(device list unavailable — use get_entities tool)";
  }
  systemPrompt = buildSystemPrompt(summary, state.personality, config.assistantName, state.personalityPrompt);
  agent.setSystemPrompt(systemPrompt);

  const memory = new MemoryStore(dataDir);
  await memory.init();

  const liveVoice = registerLiveVoiceRoutes(app, {
    registry, memory, allowedOrigins: config.allowedOrigins, enabled: () => state.liveVoiceEnabled === true,
    instructions: () => buildLivePrompt({ name: config.assistantName, personality: state.personality, personalityPrompt: state.personalityPrompt,
      template: state.liveVoicePrompt, tools: true, search: searchTools.length > 0, memory: memory.isEnabled() }),
    createAgent: session => {
      const selected = registry.resolve(state.model);
      const modelPrivate = privateProviderGuard(registry, selected.providerId);
      const speechPrivate = session.speechPrivate;
      const allowed = () => modelPrivate() && speechPrivate();
      session.canUsePrivate = allowed;
      guardVoicePrivacy(session, allowed);
      return new Agent(selected.client, selected.model, [...tools, ...searchTools], liveBackendPrompt(
        buildSystemPrompt(summary, "plain", config.assistantName), state.liveBackendPrompt),
        (text, signal, event) => beginVoiceMemory(memory, session, text, allowed, signal, event));
    },
  });
  registerSettingsRoutes(app, {
    store,
    agent,
    state,
    registry,
    fallbackModel,
    get summary() { return summary; },
    name: config.assistantName,
    setSystemPrompt,
    inference,
    localInference,
    onLiveVoiceDisabled: () => liveVoice.sweep(),
    onCredentialsChanged(credentials) {
      if (config.braveApiKey !== credentials.braveApiKey) {
        config.braveApiKey = credentials.braveApiKey;
        searchTools.splice(0, searchTools.length, ...(credentials.braveApiKey
          ? buildSearchTools(new BraveSearchClient(credentials.braveApiKey)) : []));
      }
      if (config.haToken !== credentials.haToken || config.haUrl !== credentials.haUrl) {
        config.haToken = credentials.haToken;
        config.haUrl = credentials.haUrl;
        ha.setConnection(credentials.haUrl, credentials.haToken);
        summary = "(device list unavailable — use get_entities tool)";
        setSystemPrompt(buildSystemPrompt(summary, state.personality, config.assistantName, state.personalityPrompt));
        // Populate area names and the device list for the new account, without delaying Save.
        if (credentials.haToken && credentials.haUrl) void (async () => {
          try {
            await ha.loadAreas();
            const fresh = await ha.entitySummary();
            if (config.haToken !== credentials.haToken || config.haUrl !== credentials.haUrl) return;
            summary = fresh;
            setSystemPrompt(buildSystemPrompt(summary, state.personality, config.assistantName, state.personalityPrompt));
          } catch { /* Keep the tool-based fallback when HA is unavailable. */ }
        })();
      }
    },
  });

  let notifications: PushNotifications | null = null;
  try {
    notifications = new PushNotifications(join(dataDir, "data", "push-notifications.json"), process.env.SAWOT_VAPID_SUBJECT,
      { log: event => app.log.info(event, "response notification"),
        isConversationAvailable: id => Boolean(chatCtx.store.get(id)) });
  } catch { app.log.warn("Response notifications unavailable: check private storage and VAPID subject configuration"); }
  registerPushRoutes(app, notifications, config.allowedOrigins);
  registerMemoryRoutes(app, memory);
  const chatCtx: ChatCtx = {
    memory,
    onResponseCompleted: notice => notifications?.enqueue(notice),
    store: new ChatStore(join(dataDir, "data", "conversations")),
    resolve: (model) => registry.resolve(model),
    isPrivateProvider: model => registry.isPrivate(model),
    isPrivateSpeechProvider: () => !state.ttsProviderId || state.ttsProviderId === "local" || registry.get(state.ttsProviderId)?.privateMemoryAccess === true,
    prepareSpeech: () => {
      const id = state.ttsProviderId ?? "local";
      const voice = state.voice;
      const provider = id === "local" ? undefined : registry.get(id);
      if (id !== "local" && (!provider || !isOpenAiSpeechProvider(provider))) {
        throw new InferenceError(400, "Select an available speech provider in Settings → Speech.", "synthesize");
      }
      const remote = provider ? { baseUrl: provider.baseUrl, apiKey: provider.apiKey ?? "", model: state.ttsModel ?? "gpt-4o-mini-tts" } : undefined;
      const speech = new InferenceClient(config.sidecarUrl, () => remote);
      return {
        isPrivate: () => id === "local" || registry.get(id)?.privateMemoryAccess === true,
        synthesize: (text: string, signal: AbortSignal) => speech.synthesize(text, voice, signal),
      };
    },
    subscribeProviderPrivacy: listener => registry.subscribePrivacy(listener),
    synthesize: (text, signal) => inference.synthesize(text, state.voice, signal),
    getContextWindow: (model) => registry.contextWindowFor(model),
    getEffortLevels: (model) => registry.effortLevelsFor(model),
    getContextInfo: (model) => registry.contextInfoFor(model),
    haTools: tools,
    searchTools,
    ha,
    uploadDir: join(dataDir, "data", "uploads"),
    name: config.assistantName,
    getEntitySummary: () => summary,
    getChatInstructions: () => state.chatInstructions,
    getDefaultModel: () => state.model,
  };
  if (config.runnerSocket) {
    const files = new AnalysisFileStore(join(dataDir, "analysis"), scope => Boolean(chatCtx.store.get(scope.conversationId)));
    chatCtx.analysis = { files, runner: new RunnerClient(config.runnerSocket) };
    app.addHook("onClose", async () => files.close());
  }
  registerChatRoutes(app, chatCtx);

  app.get("/health", async () => ({ ok: true, backend: "typescript" }));
  const resources = new ResourceMonitor({ sidecarUrl: config.sidecarUrl, sidecarPid: Number(process.env.SAWOT_SIDECAR_PID) || undefined });
  app.get("/api/resources", async (_req: any, reply: any) => {
    reply.header("Cache-Control", "no-store");
    return resources.snapshot ?? await resources.sample();
  });
  app.addHook("onClose", async () => resources.stop());
  app.get("/api/status", async () => ({
    ok: true,
    model: state.model,
    voice: state.voice,
    sidecar: await inference.health().catch(() => null),
  }));

  // Voice pipeline over WebSocket (direct ws + Fastify's upgrade event;
  // @fastify/websocket 11.x mis-wraps handlers under Fastify 5).
  const wss = new WebSocketServer({
    noServer: true,
    verifyClient: ({ origin }: { origin: string }) => isAllowedVoiceOrigin(origin, config.allowedOrigins),
  });
  app.server.on("upgrade", (req: any, socket: any, head: any) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (pathname !== "/ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws: any) => {
      const voiceMemory: VoiceMemorySession = { id: `voice:${randomUUID()}` };
      let pendingTurnId: number | null = null;
      let pendingImageIds: unknown;
      let legacyTurnId = 0;
      const session = new VoiceSession((turnId, kind, payload) => {
        if (ws.readyState !== 1) return;
        if (kind === "wav") {
          ws.send(JSON.stringify({ type: "audio", turnId }));
          ws.send(payload);
        } else ws.send(JSON.stringify({ type: kind, ...payload, turnId }));
      });
      const stopVoiceMemory = memory.subscribe(() => {
        if (memory.conversationIsPrivate(voiceMemory.id)) voiceMemory.privateMemoryUsed = true;
      });
      ws.on("close", () => { stopVoiceMemory(); session.cancel(); });
      const getCards = (ids: string[]) => ha.getCards(ids);

      const startTurn = (turnId: number, audio: Buffer | null, imageIds: unknown) => {
        const selectedModel = state.model;
        const llm = registry.resolve(selectedModel);
        const modelPrivate = privateProviderGuard(registry, llm.providerId);
        const speechId = state.ttsProviderId || "local";
        const speechPrivate = speechId === "local" ? () => true : privateProviderGuard(registry, speechId);
        const allowed = () => modelPrivate() && speechPrivate();
        const turnAgent = new Agent(llm.client, llm.model, [...tools, ...searchTools], systemPrompt,
          (text, signal, event) => beginVoiceMemory(memory, voiceMemory, text, allowed, signal, event));
        turnAgent.setDetailedDrawings(state.detailedDrawings);
        const voice = state.voice;
        void session.start(turnId, async (history, send, signal) => {
          const controller = new AbortController();
          const turnSignal = AbortSignal.any([signal, controller.signal]);
          const guard = () => guardVoicePrivacy(voiceMemory, allowed);
          const check = () => { try { guard(); } catch { controller.abort(); } };
          const stopPrivacy = registry.subscribePrivacy(check);
          const stopMemory = memory.subscribe(() => { check(); if (!memory.isEnabled()) controller.abort(); });
          try {
            guard();
            const turnInference = inference.snapshot();
            const [images, contextWindow] = await Promise.all([
              loadVoiceImages(imageIds, chatCtx.uploadDir), registry.contextWindowFor(selectedModel),
            ]);
            if (turnSignal.aborted) return;
            await runVoiceTurn(turnInference, turnAgent, audio, history, send, voice, getCards, { ...llm, contextWindow }, turnSignal, images, guard);
          } catch (error) {
            if (error instanceof VoiceMemoryError) await send("error", { message: error.message });
            else throw error;
          } finally { stopPrivacy(); stopMemory(); }

        });
      };

      ws.on("message", (data: any, isBinary: boolean) => {
        if (isBinary) {
          // Freeze the settings for this request, including every model round.
          const turnId = pendingTurnId ?? --legacyTurnId;
          const imageIds = pendingImageIds;
          pendingTurnId = null;
          pendingImageIds = undefined;
          startTurn(turnId, Buffer.from(data), imageIds);
        } else {
          let message: any;
          try { message = JSON.parse(data.toString()); } catch { return; }
          if (message?.type === "cancel") {
            pendingTurnId = null;
            pendingImageIds = undefined;
            session.cancel();
          } else if (message?.type === "voice_start" && Number.isSafeInteger(message.turnId) && message.turnId > 0) {
            pendingTurnId = message.turnId;
            pendingImageIds = message.imageIds;
          } else if (message?.type === "voice_images" && Number.isSafeInteger(message.turnId) && message.turnId > 0) {
            pendingTurnId = null;
            pendingImageIds = undefined;
            startTurn(message.turnId, null, message.imageIds);
          } else {
            void handleControl(ws, data.toString());
          }
        }
      });
    });
  });

  app.register(fastifyStatic, { root: join(root, "web", "dist"), prefix: "/" });

  await app.listen({ port: config.port, host: config.host });
  console.log("SAWOT TS backend listening on http" + (https ? "s" : "") + "://" + config.host + ":" + config.port);
  resources.start();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
