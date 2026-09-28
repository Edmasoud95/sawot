import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createChatCompletion } from "./reasoningFallback.js";
import { conversationErrorMessage } from "./conversationError.js";
import { parseExpressionMarkers } from "./expressions.js";
import { stripSpeechTags } from "./speechTags.js";
import { isDeepSeekEndpoint, type EffortLevel } from "./effort.js";
import { DEFAULT_CONTEXT_WINDOW, type ContextInfo } from "./providers.js";
import { chatCommand, CHAT_HELP, statusReply } from "./chatCommands.js";
import { extname, join } from "node:path";
import type { FastifyInstance } from "fastify";

import { ChatStore, newId, runChat, SAFE_ID, toOpenAiMessages } from "./chat.js";
import { buildChatSystemPrompt, todayLabel } from "./chatPrompt.js";
import type { HomeAssistant } from "./ha.js";
import { toOpenAiTools, type Tool } from "./tools.js";

const MAX_UPLOAD = 10 * 1024 * 1024;
const TEXT_CAP = 50000;
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const TEXT_EXTS = new Set([
  ".txt", ".md", ".csv", ".json", ".py", ".js", ".jsx", ".ts", ".tsx",
  ".yaml", ".yml", ".html", ".css", ".sh", ".toml", ".ini", ".log",
]);

const UPLOAD_MEDIA: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".pdf": "application/pdf",
};

export interface ChatCtx {
  store: ChatStore;
  /** Resolve a (possibly provider-qualified) model id to its client. */
  resolve: (model: string) => { client: any; model: string; providerId?: string; providerName?: string };
  synthesize?: (text: string, signal: AbortSignal) => Promise<Buffer>;
  getEffortLevels?: (model: string) => EffortLevel[];
  getContextWindow?: (model: string) => Promise<number>;
  getContextInfo?: (model: string) => Promise<ContextInfo>;
  /** Home Assistant tools, offered only when the conversation asks for them. */
  haTools: Tool[];
  isHomeAssistantConfigured?: () => boolean;
  /** Shared web tools, including find_in_page; empty without a search key. */
  searchTools: Tool[];
  ha: HomeAssistant | null;
  uploadDir: string;
  /** Assistant name from config. */
  name: string;
  getEntitySummary: () => string;
  getChatInstructions: () => string;
  getDefaultModel: () => string;
}

function findUploadFile(dir: string, uid: string): string | null {
  try {
    for (const e of readdirSync(dir)) {
      if (e.startsWith(uid + ".") && !e.endsWith(".pdftxt")) return e;
    }
  } catch {
    /* dir missing */
  }
  return null;
}

async function maybeTitle(ctx: ChatCtx, conv: any, signal: AbortSignal): Promise<void> {
  if (conv.title !== "New chat") return;
  const firstMessage = conv.messages.find((m: any) => m.role === "user" && !m.command);
  if (!firstMessage) return;
  try {
    const { client, model } = ctx.resolve(conv.model);
    const resp = await createChatCompletion<any>(client, {
      model,
      messages: [{
        role: "user",
        content:
          "Title this conversation in at most 5 words. Reply with the title only.\n\nFirst message: " +
          String(firstMessage.content ?? "").slice(0, 500),
      }],
    }, { signal });
    const title = (resp.choices[0].message.content ?? "").trim().replace(/^"|"$/g, "");
    if (title) conv.title = title.slice(0, 80);
  } catch {
    /* auto-title is best-effort */
  }
}

export function registerChatRoutes(app: FastifyInstance, ctx: ChatCtx): void {
  const activeTurns = new Map<string, { controller: AbortController; finished: Promise<void>; finish: () => void }>();
  const homeConfigured = () => ctx.isHomeAssistantConfigured?.() ?? ctx.ha?.isConfigured() ?? false;
  const setupRequired = { detail: "Set up Home Assistant in Settings → Connections before enabling it." };
  app.post("/api/chat/speech", async (req: any, reply: any) => {
    const text = req.body?.text;
    if (typeof text !== "string" || text.length > 2000) return reply.code(400).send({ detail: "Invalid speech text." });
    const spoken = stripSpeechTags(parseExpressionMarkers(text).reply);
    if (!spoken) return reply.code(400).send({ detail: "This message has no text to read." });
    if (!ctx.synthesize) return reply.code(503).send({ detail: "Speech is unavailable." });
    const controller = new AbortController();
    const close = () => { if (!reply.raw.writableEnded) controller.abort(); };
    reply.raw.on("close", close);
    try {
      const audio = await ctx.synthesize(spoken, controller.signal);
      return reply.type("audio/wav").header("Cache-Control", "no-store").send(audio);
    } catch (e) {
      return reply.code(502).send({ detail: conversationErrorMessage(e) });
    } finally { reply.raw.off("close", close); }
  });
  app.get("/api/chat/tools", async () => ({ homeAssistant: homeConfigured() }));
  app.get("/api/chat/conversations", async () => ctx.store.list());

  app.post("/api/chat/conversations", async (req: any, reply: any) => {
    const body = req.body ?? {};
    if (body.homeAssistant && !homeConfigured()) return reply.code(409).send(setupRequired);
    const model = body.model || ctx.getDefaultModel();
    return ctx.store.create(model, Boolean(body.homeAssistant), body.webSearch !== false);
  });

  app.get("/api/chat/conversations/:cid", async (req: any, reply: any) => {
    const conv = ctx.store.get(req.params.cid);
    if (!conv) return reply.code(404).send({ detail: "not found" });
    return conv;
  });

  app.patch("/api/chat/conversations/:cid", async (req: any, reply: any) => {
    const conv = ctx.store.get(req.params.cid);
    if (!conv) return reply.code(404).send({ detail: "not found" });
    const body = req.body ?? {};
    if (body.homeAssistant && !homeConfigured()) return reply.code(409).send(setupRequired);
    const model = "model" in body ? String(body.model) : conv.model;
    const levels = ctx.getEffortLevels?.(model) ?? [];
    if ("reasoningEffort" in body && body.reasoningEffort !== null && !levels.includes(body.reasoningEffort)) {
      return reply.code(400).send({ detail: "That effort level is not supported by this model. Choose Default or an available level." });
    }
    if ("reasoningEffort" in body) conv.reasoningEffort = body.reasoningEffort;
    else if (model !== conv.model && !levels.includes(conv.reasoningEffort)) conv.reasoningEffort = null;
    if ("title" in body) conv.title = String(body.title).slice(0, 80);
    if ("model" in body) conv.model = String(body.model);
    if ("homeAssistant" in body) conv.homeAssistant = Boolean(body.homeAssistant);
    if ("webSearch" in body) conv.webSearch = Boolean(body.webSearch);
    if ("draftText" in body) {
      const text = String(body.draftText ?? "");
      conv.draftText = text.trim().split(/\s+/u).filter(Boolean).length >= 3 ? text : "";
      conv.updated = Date.now() / 1000;
    }
    ctx.store.save(conv);
    return conv;
  });

  app.delete("/api/chat/conversations/:cid", async (req: any, reply: any) => {
    if (!SAFE_ID.test(req.params.cid)) return reply.code(400).send({ detail: "Invalid conversation ID" });
    activeTurns.get(req.params.cid)?.controller.abort();
    try { ctx.store.delete(req.params.cid, ctx.uploadDir); }
    catch { return reply.code(500).send({ detail: "Could not delete the conversation and its files. Please try again." }); }
    return reply.code(204).send();
  });

  app.post("/api/chat/upload", async (req: any, reply: any) => {
    const part = await req.file();
    if (!part) return reply.code(400).send({ detail: "no file" });
    const data: Buffer = await part.toBuffer();
    if (data.length > MAX_UPLOAD) {
      return reply.code(400).send({ detail: "file too large (max 10 MB)" });
    }
    const conversationId = req.query?.conversationId;
    if (conversationId && (!SAFE_ID.test(conversationId) || !ctx.store.get(conversationId))) {
      return reply.code(404).send({ detail: "Conversation no longer exists" });
    }
    const ext = extname(part.filename ?? "").toLowerCase();
    const uid = newId();
    // Register ownership before writing, also covering unsent/removed attachments.
    if (conversationId && (IMAGE_EXTS.has(ext) || TEXT_EXTS.has(ext) || ext === ".pdf")) {
      const conv = ctx.store.get(conversationId);
      conv.uploadIds = [...(conv.uploadIds ?? []), uid];
      ctx.store.save(conv);
    }
    if (IMAGE_EXTS.has(ext)) {
      writeFileSync(join(ctx.uploadDir, uid + ext), data);
      return { id: uid, name: part.filename, kind: "image" };
    }
    if (TEXT_EXTS.has(ext)) {
      const text = data.toString("utf8").slice(0, TEXT_CAP);
      writeFileSync(join(ctx.uploadDir, uid + ext), data);
      return { id: uid, name: part.filename, kind: "text", text };
    }
    if (ext === ".pdf") {
      // NOTE: PDF text extraction (pypdf in the Python backend) is not yet
      // ported to TypeScript; store the file and leave an empty sidecar.
      writeFileSync(join(ctx.uploadDir, uid + ".pdf"), data);
      writeFileSync(join(ctx.uploadDir, uid + ".pdftxt"), "");
      return { id: uid, name: part.filename, kind: "pdf", text: "" };
    }
    return reply.code(400).send({ detail: "unsupported file type: " + (ext || "unknown") });
  });

  app.get("/api/chat/uploads/:uid", async (req: any, reply: any) => {
    const uid = req.params.uid;
    if (!SAFE_ID.test(uid)) return reply.code(404).send();
    const file = findUploadFile(ctx.uploadDir, uid);
    if (!file) return reply.code(404).send();
    const path = join(ctx.uploadDir, file);
    const media = UPLOAD_MEDIA[extname(path).toLowerCase()] ?? "text/plain; charset=utf-8";
    return reply.type(media).send(readFileSync(path));
  });

  app.post("/api/chat/conversations/:cid/cancel", async (req: any, reply: any) => {
    const turn = activeTurns.get(req.params.cid);
    if (turn) { turn.controller.abort(); await turn.finished; }
    return reply.code(204).send();
  });

  app.post("/api/chat/conversations/:cid/messages", async (req: any, reply: any) => {
    const conv = ctx.store.get(req.params.cid);
    if (!conv) return reply.code(404).send({ detail: "not found" });
    const body = req.body ?? {};
    const regenerating = Object.hasOwn(body, "regenerateFrom");
    if (activeTurns.has(conv.id)) return reply.code(409).send({ detail: "This conversation is still responding. Try again when it finishes." });
    if (regenerating) {
      const index = body.regenerateFrom;
      if (!Number.isInteger(index) || index < 0 || conv.messages[index]?.role !== "user") {
        return reply.code(400).send({ detail: "Choose a user message to regenerate its answer." });
      }
      if (body.expectedMessageCount !== conv.messages.length) {
        return reply.code(409).send({ detail: "This conversation changed. Reopen it before regenerating." });
      }
      conv.messages = conv.messages.slice(0, index + 1);
    }
    const command = regenerating ? null : chatCommand(body.content);
    if (!command && !regenerating) {
      conv.draftText = "";
      conv.messages.push({ role: "user", content: body.content ?? "", attachments: body.attachments ?? [] });
      conv.updated = Date.now() / 1000;
      ctx.store.save(conv);
    }

    const controller = new AbortController();
    let finish!: () => void;
    const finished = new Promise<void>(resolve => { finish = resolve; });
    activeTurns.set(conv.id, { controller, finished, finish });
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const close = () => { if (!raw.writableEnded) controller.abort(); };
    raw.on("close", close);
    const sse = (obj: any) => { if (!raw.destroyed) raw.write("data: " + JSON.stringify(obj) + "\n\n"); };
    if (regenerating) sse({ type: "regenerating", from: body.regenerateFrom });

    const assistant: any = { role: "assistant", content: "", thinking: "", cards: [] };
    if (command) assistant.command = command;
    let persisted = false;
    let completed = false;
    const persist = () => {
      if (command || persisted || (regenerating && (!completed || controller.signal.aborted))) return;
      persisted = true;
      // The composer may have saved the next draft while this response streamed.
      const latest = ctx.store.get(conv.id);
      if (!latest) return; // Deleted while the model was responding.
      conv.draftText = latest.draftText ?? "";
      conv.uploadIds = latest.uploadIds ?? [];
      conv.model = latest.model;
      conv.reasoningEffort = latest.reasoningEffort ?? null;
      conv.messages.push(assistant);
      conv.updated = Date.now() / 1000;
      ctx.store.save(conv);
    };

    try {
      if (command === "help") {
        assistant.content = CHAT_HELP;
        persist();
        sse({ type: "done", message: assistant, title: conv.title });
        return;
      }
      const pending = command && body.attachments?.length
        ? [{ role: "user", content: "", attachments: body.attachments }] : [];
      const llm = ctx.resolve(conv.model);
      const history = toOpenAiMessages([...conv.messages, ...pending], ctx.uploadDir, isDeepSeekEndpoint(llm.client.baseURL));
      const homeAssistant = Boolean(conv.homeAssistant) && homeConfigured();
      const searchTools = conv.webSearch !== false ? ctx.searchTools : [];
      const tools = [...searchTools, ...(homeAssistant ? ctx.haTools : [])];
      const system = buildChatSystemPrompt({
        name: ctx.name,
        instructions: ctx.getChatInstructions(),
        today: todayLabel(),
        homeAssistant,
        entitySummary: ctx.getEntitySummary(),
        search: searchTools.length > 0,
      });
      const getCards = homeAssistant && ctx.ha ? (ids: string[]) => ctx.ha!.getCards(ids) : undefined;
      if (command === "status") {
        const context = await ctx.getContextInfo?.(conv.model)
          ?? { tokens: DEFAULT_CONTEXT_WINDOW, source: "default" as const };
        Object.assign(assistant, statusReply(llm.model, llm.providerName ?? llm.providerId ?? "Unknown provider", context,
          [{ role: "system", content: system }, ...history], toOpenAiTools(tools)));
        persist();
        sse({ type: "done", message: assistant, title: conv.title });
        return;
      }
      if (conv.reasoningEffort != null && !(ctx.getEffortLevels?.(conv.model) ?? []).includes(conv.reasoningEffort)) {
        throw new Error("The selected effort is no longer supported. Choose Default or another effort level in the model picker.");
      }
      const contextWindow = await ctx.getContextWindow?.(conv.model) ?? DEFAULT_CONTEXT_WINDOW;
      sse({ type: "debug", event: "context", data: {
        model: llm.model, providerId: llm.providerId, providerName: llm.providerName,
        contextWindow,
      } });
      const effort = conv.reasoningEffort ?? ((ctx.getEffortLevels?.(conv.model) ?? []).includes("medium") ? "medium" : null);
      for await (const [event, data] of runChat(
        llm.client, llm.model, tools, system, history, getCards, effort, controller.signal,
      )) {
        if (event === "thinking") {
          assistant.thinking += data;
          sse({ type: "thinking", delta: data });
        } else if (event === "content") {
          assistant.content += data;
          sse({ type: "content", delta: data });
        } else if (event === "tool") {
          sse({ type: "tool", ...data });
        } else if (event === "search") {
          assistant.search = data;
          sse({ type: "search", ...data });
        } else if (event === "debug") {
          sse({ type: "debug", ...data });
        } else if (event === "entities") {
          assistant.cards = data;
          sse({ type: "entities", entities: data });
        } else if (event === "final") {
          assistant.content = data.content;
          assistant.thinking = data.thinking;
        }
      }
      controller.signal.throwIfAborted();
      await maybeTitle(ctx, conv, controller.signal);
      controller.signal.throwIfAborted();
      completed = true;
      persist();
      sse({ type: "done", message: assistant, title: conv.title });
    } catch (e: any) {
      if (assistant.search?.phase === "start") assistant.search.phase = "error";
      persist();
      sse({ type: "error", message: conversationErrorMessage(e) });
    } finally {
      persist();
      raw.off("close", close);
      activeTurns.delete(conv.id);
      finish();
      raw.end();
    }
  });
}
