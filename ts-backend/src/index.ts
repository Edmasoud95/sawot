import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import Fastify from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { WebSocketServer } from "ws";
import proxy from "@fastify/http-proxy";

import { Agent, buildSystemPrompt } from "./agent.js";
import { ChatStore } from "./chat.js";
import { registerChatRoutes, type ChatCtx } from "./chatRoutes.js";
import { loadConfig } from "./config.js";
import { HomeAssistant } from "./ha.js";
import { InferenceClient } from "./inference.js";
import { runVoiceTurn, type SendFn } from "./pipeline.js";
import { ProviderRegistry, qualifyModel } from "./providers.js";
import { registerSettingsRoutes, SettingsStore, type SettingsState } from "./settings.js";
import { buildHaTools } from "./tools.js";

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

async function handleControl(
  socket: any,
  ha: HomeAssistant,
  raw: string,
  controls: Record<string, string[]>,
): Promise<void> {
  let msg: any;
  try {
    msg = JSON.parse(raw);
  } catch {
    socket.send(JSON.stringify({ type: "error", message: "malformed message" }));
    return;
  }
  if (msg.type !== "control") {
    socket.send(JSON.stringify({ type: "error", message: "unknown message type" }));
    return;
  }
  const { domain, service, entity_id } = msg;
  if (!entity_id || !(controls[domain] ?? []).includes(service)) {
    socket.send(JSON.stringify({ type: "error", message: "control not allowed" }));
    return;
  }
  try {
    await ha.callService(domain, service, entity_id, msg.data);
    const cards = await ha.getCards([entity_id]);
    socket.send(JSON.stringify({ type: "entities", entities: cards }));
  } catch {
    socket.send(JSON.stringify({ type: "error", message: "control failed" }));
  }
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

  const inference = new InferenceClient(config.sidecarUrl);
  const ha = new HomeAssistant(config.haUrl, config.haToken);
  const tools = buildHaTools(ha);

  const store = new SettingsStore(join(dataDir, "settings.json"));
  const overrides = store.load();
  const registry = new ProviderRegistry(
    { id: "local", name: "Local server", baseUrl: config.llmUrl, builtin: true },
    Array.isArray(overrides.providers) ? overrides.providers : [],
  );
  // Warm every provider's model list in the background so pickers have
  // something at once; a sleeping provider only delays its own entry.
  void registry.listAllModels().catch(() => {});
  const fallbackModel = qualifyModel(registry.defaultId, config.llmModel);
  const initial = registry.resolve(overrides.model ?? fallbackModel);
  const state: SettingsState = {
    model: qualifyModel(initial.providerId, initial.model),
    voice: overrides.voice ?? config.ttsVoice,
    sassy: overrides.sassy ?? config.assistantSassy,
    detailedDrawings: Boolean(overrides.detailedDrawings ?? false),
  };

  let summary = "";
  let systemPrompt = buildSystemPrompt(summary, state.sassy, config.assistantName);
  const agent = new Agent(initial.client, initial.model, tools, systemPrompt);
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
  systemPrompt = buildSystemPrompt(summary, state.sassy, config.assistantName);
  agent.setSystemPrompt(systemPrompt);

  registerSettingsRoutes(app, {
    store,
    agent,
    state,
    registry,
    fallbackModel,
    summary,
    name: config.assistantName,
    setSystemPrompt,
    inference,
  });

  const chatCtx: ChatCtx = {
    store: new ChatStore(join(dataDir, "data", "conversations")),
    resolve: (model) => registry.resolve(model),
    tools,
    ha,
    uploadDir: join(dataDir, "data", "uploads"),
    getSystemPrompt: () => systemPrompt,
    getDefaultModel: () => state.model,
  };
  registerChatRoutes(app, chatCtx);

  app.get("/health", async () => ({ ok: true, backend: "typescript" }));
  app.get("/api/status", async () => ({
    ok: true,
    model: state.model,
    voice: state.voice,
    sidecar: await inference.health().catch(() => null),
  }));

  // Voice pipeline over WebSocket (direct ws + Fastify's upgrade event;
  // @fastify/websocket 11.x mis-wraps handlers under Fastify 5).
  const wss = new WebSocketServer({ noServer: true });
  app.server.on("upgrade", (req: any, socket: any, head: any) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (pathname !== "/ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws: any) => {
      const history: any[] = [];
      const controls = config.allowedControls ?? DEFAULT_ALLOWED_CONTROLS;
      const send: SendFn = async (kind, payload) => {
        if (kind === "wav") ws.send(payload);
        else ws.send(JSON.stringify({ type: kind, ...payload }));
      };
      const getCards = (ids: string[]) => ha.getCards(ids);

      ws.on("message", (data: any, isBinary: boolean) => {
        if (isBinary) {
          runVoiceTurn(
            inference, agent, Buffer.from(data), history, send, state.voice, getCards,
          ).catch((e) => send("error", { message: String(e?.message ?? e) }));
        } else {
          handleControl(ws, ha, data.toString(), controls);
        }
      });
    });
  });

  app.register(fastifyStatic, { root: join(root, "web", "dist"), prefix: "/" });

  await app.listen({ port: config.port, host: config.host });
  console.log("SAWOT TS backend listening on http" + (https ? "s" : "") + "://" + config.host + ":" + config.port);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
