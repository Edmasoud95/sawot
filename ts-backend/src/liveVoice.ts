import { buildLivePrompt } from "./livePrompts.js";
import { LiveToolSession, type LiveTurn } from "./liveTools.js";
import type { Agent } from "./agent.js";
import type { FastifyInstance } from "fastify";
import type { ProviderRegistry } from "./providers.js";
import { isOpenAiSpeechProvider, openAiSpeechError } from "./openaiSpeech.js";
import { isAllowedVoiceOrigin } from "./voiceOrigin.js";

export const LIVE_VOICES = ["marin", "cedar", "quartz", "ripple", "vesper", "willow", "stone", "gleam", "meridian", "bossa", "tempo", "beacon", "delta", "cinder"];
const API = "https://api.openai.com/v1/live/sessions";
const ID = /^[a-f0-9]{32}$/;

interface Session {
  key: string;
  tools?: LiveToolSession;
  remoteId?: string;
  lastSeen: number;
  closing: boolean;
  pending: boolean;
  closingRequest?: Promise<boolean>;
}
interface LiveContext {
  registry: ProviderRegistry;
  allowedOrigins: readonly string[];
  enabled: () => boolean;
  instructions?: () => string;
  createAgent?: () => Agent;
  fetch?: typeof fetch;
  now?: () => number;
}

/** Server-owned paid-session lifecycle. Audio travels directly over WebRTC. */
export function registerLiveVoiceRoutes(app: FastifyInstance, ctx: LiveContext) {
  const sessions = new Map<string, Session>();
  const request = ctx.fetch ?? fetch;
  const now = ctx.now ?? Date.now;
  let shuttingDown = false;
  const headers = (key: string) => ({ "Content-Type": "application/json", Authorization: "Bearer " + key });

  async function close(id: string): Promise<boolean> {
    const session = sessions.get(id);
    if (!session) return true;
    session.closing = true;
    session.tools?.close();
    // Let an in-flight creation finish so its eventual remote ID can be closed.
    if (!session.remoteId) return true;
    if (session.closingRequest) return session.closingRequest;
    session.closingRequest = (async () => {
      try {
        const response = await request(`${API}/${encodeURIComponent(session.remoteId!)}/hangup`, {
          method: "POST", headers: headers(session.key), redirect: "error", signal: AbortSignal.timeout(5000),
        });
        const ended = response.ok || response.status === 404 || response.status === 410;
        await response.body?.cancel();
        if (ended) sessions.delete(id);
        return ended;
      } catch { return false; }
      finally { session.closingRequest = undefined; }
    })();
    return session.closingRequest;
  }
  async function sweep() {
    await Promise.all([...sessions].filter(([, s]) => s.closing || !ctx.enabled() || now() - s.lastSeen > (s.pending ? 30_000 : 15_000))
      .map(([id]) => close(id)));
  }
  const timer = setInterval(() => { void sweep(); }, 2000);
  timer.unref();
  app.addHook("onClose", async () => {
    shuttingDown = true;
    clearInterval(timer);
    await Promise.all([...sessions.keys()].map(close));
  });

  app.get("/api/live/config", async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
    const enabled = ctx.enabled();
    return { enabled, model: "gpt-live-1", inactivityMs: 30_000, trial: true,
      voices: enabled ? LIVE_VOICES : [],
      providers: enabled ? ctx.registry.list().filter(p => p.hasKey && isOpenAiSpeechProvider(p)).map(p => ({ id: p.id, name: p.name })) : [] };
  });

  const authorize = (req: any, reply: any) => {
    reply.header("Cache-Control", "no-store");
    if (!isAllowedVoiceOrigin(req.headers.origin, ctx.allowedOrigins)) {
      reply.code(403).send({ detail: "This origin is not allowed to start or manage voice sessions." });
      return false;
    }
    return true;
  };
  app.post("/api/live/sessions", { bodyLimit: 70_000 }, async (req: any, reply) => {
    if (!authorize(req, reply)) return;
    if (!ctx.enabled() || shuttingDown) return reply.code(403).send({ detail: "Enable the Live voice trial in Settings → Advanced first." });
    const { id, sdp, providerId, voice } = req.body ?? {};
    if (typeof id !== "string" || !ID.test(id) || typeof sdp !== "string" || !sdp.startsWith("v=0") || sdp.length > 65_536 ||
      !LIVE_VOICES.includes(voice) || typeof providerId !== "string") {
      return reply.code(400).send({ detail: "Invalid Live voice connection settings." });
    }
    const provider = ctx.registry.get(providerId);
    if (!provider?.apiKey || !isOpenAiSpeechProvider(provider)) return reply.code(400).send({ detail: "Choose a configured OpenAI account in Settings → Speech." });
    if (sessions.has(id)) return reply.code(409).send({ detail: "This Live session already exists." });
    if (sessions.size >= 8) return reply.code(429).send({ detail: "Too many Live sessions. End an existing session first." });
    const session: Session = { tools: ctx.createAgent ? new LiveToolSession(ctx.createAgent) : undefined, key: provider.apiKey, lastSeen: now(), closing: false, pending: true };
    sessions.set(id, session);
    const disconnected = () => { if (!reply.raw.writableEnded) void close(id); };
    reply.raw.once("close", disconnected);
    try {
      const response = await request(API, {
        method: "POST", headers: headers(session.key), redirect: "error", signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({ session: { model: "gpt-live-1", store: false, instructions: ctx.instructions?.() ?? buildLivePrompt({ tools: !!ctx.createAgent }),
          audio: { output: { voice } }, delegation: { type: "client" } }, transport: { type: "webrtc", sdp } }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        sessions.delete(id);
        return reply.code(response.status === 401 || response.status === 403 || response.status === 429 ? response.status : 502)
          .send({ detail: openAiSpeechError(response.status).replaceAll("speech", "Live voice") });
      }
      const body: any = await response.json();
      if (typeof body.session?.id === "string" && body.session.id.length < 256) session.remoteId = body.session.id;
      session.pending = false;
      if (!session.remoteId || typeof body.transport?.sdp !== "string" || body.transport.sdp.length > 65_536) {
        if (session.remoteId) await close(id); else sessions.delete(id);
        return reply.code(502).send({ detail: "OpenAI returned an invalid Live connection." });
      }
      if (session.closing || !ctx.enabled() || shuttingDown) {
        await close(id);
        return reply.code(409).send({ detail: "Live startup was cancelled." });
      }
      session.lastSeen = now();
      return reply.code(201).send({ id, sdp: body.transport.sdp });
    } catch {
      if (session.remoteId) await close(id); else sessions.delete(id);
      return reply.code(502).send({ detail: "Couldn't establish OpenAI Live voice. Check your connection and model access." });
    } finally { reply.raw.off("close", disconnected); }
  });

  app.post("/api/live/sessions/:id/delegate", { bodyLimit: 80_000 }, async (req: any, reply) => {
    if (!authorize(req, reply)) return;
    const session = sessions.get(req.params.id);
    if (!ctx.enabled() || !session || session.closing || session.pending || !session.tools) {
      return reply.code(409).send({ detail: "Live tools are unavailable or the session has ended." });
    }
    const { delegationId, turns } = req.body ?? {};
    if (typeof delegationId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(delegationId) ||
      !Array.isArray(turns) || turns.length > 40 || !turns.length || turns.some((turn: any) =>
        !turn || !["user", "assistant"].includes(turn.role) || typeof turn.text !== "string" || turn.text.length > 4000 ||
        !Number.isFinite(turn.start) || !Number.isFinite(turn.end) || turn.start < 0 || turn.end < turn.start) ||
      turns.reduce((n: number, turn: any) => n + turn.text.length, 0) > 20_000) {
      return reply.code(400).send({ detail: "Invalid Live task context." });
    }
    const result = await session.tools.run(delegationId, turns as LiveTurn[]);
    if (session.closing || !ctx.enabled()) return reply.code(409).send({ detail: "The Live session ended." });
    return result;
  });

  app.post("/api/live/sessions/:id/heartbeat", async (req: any, reply) => {
    if (!authorize(req, reply)) return;
    const session = sessions.get(req.params.id);
    if (!session || session.closing || !ctx.enabled()) {
      if (session) await close(req.params.id);
      return reply.code(404).send({ detail: "The Live session has ended." });
    }
    session.lastSeen = now();
    return { ok: true };
  });
  app.post("/api/live/sessions/:id/close", async (req: any, reply) => {
    if (!authorize(req, reply)) return;
    if (!ID.test(req.params.id)) return reply.code(400).send({ detail: "Invalid Live session." });
    const ended = await close(req.params.id);
    return reply.code(ended ? 200 : 502).send(ended ? { ok: true } : { detail: "Remote closure is not confirmed; SAWOT will retry." });
  });
  return { sweep };
}
