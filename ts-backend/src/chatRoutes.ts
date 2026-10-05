import { addFileInventory } from "./analysis/context.js";
import { buildAnalysisTools } from "./analysis/tools.js";
import { registerAnalysisRoutes, visibleTurns } from "./analysis/routes.js";
import { importAnalysisAttachments } from "./analysis/attachments.js";
import type { AnalysisFileStore } from "./analysis/fileStore.js";
import type { Runner, AnalysisEvent } from "./analysis/types.js";
import { randomUUID } from "node:crypto";
import type { ChatCompletionNotice } from "./pushNotifications.js";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createChatCompletion } from "./reasoningFallback.js";
import { conversationErrorMessage } from "./conversationError.js";
import { InferenceError } from "./inference.js";
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
import type { MemoryStore, MemoryEvent } from "./memory/store.js";
import { buildMemoryTools } from "./memory/tools.js";

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
  memory?: MemoryStore;
  onResponseCompleted?: (notice: ChatCompletionNotice) => void | Promise<void>;
  analysis?: { files: AnalysisFileStore; runner: Runner };
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
  const activityReference = (event: MemoryEvent) => ({ ...event, memories: event.memories.map(m => ({ id: m.id, revision: m.revision })) });
  // Canonical activity lives with the memory store, never duplicated fact text
  // in conversation JSON. This also recovers operations after a process crash.
  const withMemory = async (conv: any) => {
    if (!ctx.memory) return conv;
    const events = (await ctx.memory.eventsForConversation(conv.id)).map(activityReference);
    const messages = conv.messages.map((m: any) => ({ ...m, memory: events.filter(e => e.turnId === m.id) }));
    const seen = new Set(messages.map((m: any) => m.id));
    for (const event of events) {
      if (seen.has(event.turnId)) continue;
      seen.add(event.turnId);
      const sourceIndex = messages.findIndex((m: any) => m.id === event.sourceMessageId && m.role === "user");
      // A replaced response's events must not resurrect its old message after
      // regeneration. Recover only an otherwise unanswered source message.
      if (sourceIndex < 0 || messages[sourceIndex + 1]?.role === "assistant") continue;
      messages.splice(sourceIndex + 1, 0, { id: event.turnId, role: "assistant", content: "", memory: events.filter(e => e.turnId === event.turnId) });
    }
    return { ...conv, messages };
  };
  if (ctx.analysis) {
    registerAnalysisRoutes(app, ctx.analysis.files, ctx.store);
    // Recover partial tool outcomes after an interrupted backend process.
    for (const entry of ctx.store.list()) {
      const saved = ctx.store.get(entry.id);
      if (saved?.pendingAnalysis) {
        const pending = saved.pendingAnalysis;
        if (!pending.regenerating) saved.messages.push({ id: pending.turnId, role: "assistant", content: "", analysis: pending.events });
        delete saved.pendingAnalysis; ctx.store.save(saved);
      }
      if (saved) ctx.analysis.files.prune(saved.id, visibleTurns(saved));
    }
  }
  const activeTurns = new Map<string, { controller: AbortController; finished: Promise<void>; analysisPending: Set<Promise<unknown>>; snapshot?: () => any }>();
  app.addHook("preClose", async () => {
    const turns = [...activeTurns.values()];
    for (const turn of turns) turn.controller.abort();
    await Promise.all(turns.map(turn => turn.finished));
  });
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
      return reply.code(502).send({ detail: e instanceof InferenceError && e.detail ? e.detail : conversationErrorMessage(e) });
    } finally { reply.raw.off("close", close); }
  });
  app.get("/api/chat/tools", async () => ({ homeAssistant: homeConfigured(), ...(ctx.analysis ? { python: (await ctx.analysis.runner.ready()).ready } : {}) }));
  app.get("/api/chat/conversations", async () => ctx.store.list());

  app.post("/api/chat/conversations", async (req: any, reply: any) => {
    const body = req.body ?? {};
    if (body.homeAssistant && !homeConfigured()) return reply.code(409).send(setupRequired);
    const model = body.model || ctx.getDefaultModel();
    return ctx.store.create(model, Boolean(body.homeAssistant), body.webSearch !== false, body.python !== false);
  });

  app.get("/api/chat/conversations/:cid", async (req: any, reply: any) => {
    const conv = ctx.store.get(req.params.cid);
    if (!conv) return reply.code(404).send({ detail: "not found" });
    const snapshot = activeTurns.get(conv.id)?.snapshot;
    reply.header("Cache-Control", "no-store");
    const result = await withMemory({ ...conv, ...(snapshot?.() ?? {}), responding: Boolean(snapshot) });
    if (!snapshot && !activeTurns.has(conv.id) && result.messages.length !== conv.messages.length) {
      // Persist crash recovery so the next regeneration's expected message
      // count agrees with the history returned to the browser.
      const latest = ctx.store.get(conv.id);
      if (latest && latest.messages.length === conv.messages.length) {
        ctx.store.save({ ...latest, messages: result.messages.map(({ memory: _memory, ...m }: any) => m) });
      }
    }
    return result;
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
    if ("python" in body) conv.python = body.python !== false;
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
    const turn = activeTurns.get(req.params.cid);
    if (turn) { turn.controller.abort(); await Promise.allSettled([...turn.analysisPending]); }
    try { ctx.analysis?.files.deleteConversation(req.params.cid); ctx.store.delete(req.params.cid, ctx.uploadDir); }
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
    if (conversationId && (IMAGE_EXTS.has(ext) || TEXT_EXTS.has(ext) || ext === ".pdf" || ext === ".xlsx")) {
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
    if (ext === ".xlsx") {
      writeFileSync(join(ctx.uploadDir, uid + ext), data);
      return { id: uid, name: part.filename, kind: "file" };
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
    const notificationDevice = typeof body.notificationDevice === "string" && /^[A-Za-z0-9_-]{43}$/.test(body.notificationDevice) ? body.notificationDevice : undefined;
    const turnId = randomUUID();
    const regenerating = Object.hasOwn(body, "regenerateFrom");
    if (activeTurns.has(conv.id)) return reply.code(409).send({ detail: "This conversation is still responding. Try again when it finishes." });
    if (ctx.analysis || ctx.memory) {
      for (const message of conv.messages) message.id ??= newId();
      ctx.store.save(conv);
    }
    if (regenerating) {
      const index = body.regenerateFrom;
      if (!Number.isInteger(index) || index < 0 || conv.messages[index]?.role !== "user") {
        return reply.code(400).send({ detail: "Choose a user message to regenerate its answer." });
      }
      if (body.expectedMessageCount !== conv.messages.length) {
        return reply.code(409).send({ detail: "This conversation changed. Reopen it before regenerating." });
      }
      const editing = Object.hasOwn(body, "content");
      if (editing && (typeof body.content !== "string" || (!body.content.trim() && !conv.messages[index].attachments?.length))) {
        return reply.code(400).send({ detail: "Enter a message before saving." });
      }
      conv.messages = conv.messages.slice(0, index + 1);
      if (editing) conv.messages[index] = { ...conv.messages[index], content: body.content };
    }
    const command = regenerating ? null : chatCommand(body.content);
    if (!command && !regenerating) {
      conv.draftText = "";
      conv.messages.push({ ...((ctx.analysis || ctx.memory) ? { id: newId() } : {}), role: "user", content: body.content ?? "", attachments: body.attachments ?? [] });
      conv.updated = Date.now() / 1000;
      ctx.store.save(conv);
    }

    const controller = new AbortController();
    const assistant: any = { ...((ctx.analysis || ctx.memory) ? { id: newId() } : {}), ...(ctx.analysis ? { analysis: [] } : {}), role: "assistant", content: "", thinking: "", cards: [] };
    if (command) assistant.command = command;
    let finish!: () => void;
    const finished = new Promise<void>(resolve => { finish = resolve; });
    const analysisPending = new Set<Promise<unknown>>();
    activeTurns.set(conv.id, { controller, finished, analysisPending,
      ...(!command ? { snapshot: () => ({ messages: [...conv.messages, assistant], responseError: null }) } : {}),
    });
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    // The HTTP connection is only a viewer. Stop/delete/shutdown cancel the
    // model; losing a browser connection must not interrupt its work.
    const sse = (obj: any) => { if (!raw.destroyed) raw.write("data: " + JSON.stringify(obj) + "\n\n"); };
    if (regenerating) sse({ type: "regenerating", from: body.regenerateFrom });

    let persisted = false;
    let savedResponse = false;
    let failed = false;
    let completed = false;
    let stopMemoryWatch: (() => void) | undefined;
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
      conv.responseError = null;
      delete conv.pendingAnalysis;
      conv.messages.push(assistant);
      conv.updated = Date.now() / 1000;
      ctx.store.save(conv);
      savedResponse = true;
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
      let analysisTools: Tool[] = [];
      let historyMessages = [...conv.messages, ...pending];
      let availableFiles: any[] = [];
      if (!command && conv.python !== false && ctx.analysis && (await ctx.analysis.runner.ready()).ready) {
        const { files, runner } = ctx.analysis;
        const scope = { conversationId: conv.id, turnId: assistant.id, visibleTurnIds: visibleTurns(conv) };
        const imported = await importAnalysisAttachments(conv, scope, files, ctx.uploadDir, controller.signal);
        const importedIds = new Set(imported.map(f => f.uploadId).filter(Boolean));
        historyMessages = historyMessages.map(message => ({ ...message, attachments: message.attachments?.filter((a: any) => a.kind === "image" || !importedIds.has(a.id)) }));
        availableFiles = files.listVisible(scope).slice(0, 100).map(f => ({ id: f.id, name: f.name, size: f.size, source: f.source }));
        const emit = (event: AnalysisEvent) => {
          const index = assistant.analysis.findIndex((e: AnalysisEvent) => e.id === event.id);
          if (index < 0) assistant.analysis.push(event); else assistant.analysis[index] = event;
          const latest = ctx.store.get(conv.id);
          if (latest) { latest.pendingAnalysis = { turnId: assistant.id, events: assistant.analysis, regenerating }; ctx.store.save(latest); }
          sse({ type: "analysis", ...event });
        };
        analysisTools = buildAnalysisTools({ scope, files, runner, signal: controller.signal, emit, pending: analysisPending, webSearch: conv.webSearch !== false });
      }
      const history = toOpenAiMessages(historyMessages, ctx.uploadDir, isDeepSeekEndpoint(llm.client.baseURL));
      addFileInventory(history, availableFiles);
      const homeAssistant = Boolean(conv.homeAssistant) && homeConfigured();
      const searchTools = conv.webSearch !== false ? ctx.searchTools : [];
      const memory = !command ? ctx.memory : undefined;
      const lastUser = [...conv.messages].reverse().find((m: any) => m.role === "user");
      const memoryScope = memory && lastUser ? await memory.beginTurn({
        conversationId: conv.id, turnId: assistant.id, sourceMessageId: lastUser.id,
        text: String(lastUser.content ?? ""), regenerating, signal: controller.signal,
      }) : undefined;
      const emitMemory = (event: MemoryEvent) => { sse({ type: "memory", ...activityReference(event) }); };
      const memoryTools = memory && memoryScope && memory.isEnabled() ? buildMemoryTools(memory, memoryScope, emitMemory) : [];
      if (memory && memoryScope && memoryTools.length) {
        stopMemoryWatch = memory.subscribe(() => {
          if (!memory.isActive(memoryScope)) controller.abort();
        });
      }
      const tools = [...searchTools, ...analysisTools, ...memoryTools, ...(homeAssistant ? ctx.haTools : [])];
      const system = buildChatSystemPrompt({
        name: ctx.name,
        instructions: ctx.getChatInstructions(),
        today: todayLabel(),
        homeAssistant,
        entitySummary: ctx.getEntitySummary(),
        search: searchTools.length > 0,
        analysis: analysisTools.length > 0,
        memory: memoryTools.length > 0,
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
        memory && memoryScope ? { prepare: async (messages) => {
          // Tool transcripts stay in the current inference loop. Refresh them
          // too, so a Settings edit/delete cannot leave an old fact in context.
          const memoryCalls = new Set<string>();
          for (const message of messages) for (const call of message.tool_calls ?? []) {
            if (["save_memory", "update_memory", "search_memories", "delete_memory"].includes(call.function?.name)) {
              memoryCalls.add(call.id);
              call.function.arguments = JSON.stringify({ details: "Memory operation already executed; see current result." });
            }
          }
          for (const message of messages) if (message.role === "tool" && memoryCalls.has(message.tool_call_id)) {
            if (!memory.isActive(memoryScope)) {
              message.content = JSON.stringify({ error: "Memory work expired or was disabled. Do not repeat writes." });
              continue;
            }
            try {
              const result = JSON.parse(message.content);
              if (Array.isArray(result.memories)) {
                result.memories = (await Promise.all(result.memories.map(async (fact: any) => {
                  try { const current = await memory.get(fact.id); return current.revision === fact.revision ? { id: current.id, revision: current.revision, text: current.text, topic: current.topic } : null; }
                  catch { return null; }
                }))).filter(Boolean);
                message.content = JSON.stringify(result);
              }
            } catch { message.content = JSON.stringify({ error: "Memory result unavailable" }); }
          }
          // Personal facts enter context only through an explicit memory tool call.
          return { suffix: "", submitted: async () => {} };
        } } : undefined,
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
      const done = await withMemory({ ...conv, messages: [assistant] });
      sse({ type: "done", message: done.messages.find((m: any) => m.id === assistant.id) ?? assistant, title: conv.title });
    } catch (e: any) {
      failed = true;
      if (assistant.search?.phase === "start") assistant.search.phase = "error";
      persist();
      const message = conversationErrorMessage(e);
      // A disconnected viewer also needs to see provider failures on return.
      const latest = !command && ctx.store.get(conv.id);
      if (latest) {
        latest.responseError = controller.signal.aborted ? null : message;
        ctx.store.save(latest);
      }
      sse({ type: "error", message });
    } finally {
      stopMemoryWatch?.();
      try {
        persist();
        if (ctx.analysis) {
          const saved = ctx.store.get(conv.id);
          if (saved) {
            delete saved.pendingAnalysis; ctx.store.save(saved);
            ctx.analysis.files.prune(conv.id, visibleTurns(saved));
          }
        }
      }
      finally {
        activeTurns.delete(conv.id);
        finish();
        if (!raw.destroyed) raw.end();
        if (completed && savedResponse && !failed && !command && !controller.signal.aborted && notificationDevice && ctx.onResponseCompleted) {
          // Release the response and turn lock before invoking independent delivery.
          setImmediate(() => {
            try {
              const saved = ctx.store.get(conv.id);
              if (!saved) return;
              Promise.resolve(ctx.onResponseCompleted!({ conversationId: conv.id, turnId, notificationDevice, title: saved.title })).catch(() => {});
            } catch { /* A notification failure cannot change a saved chat. */ }
          });
        }
      }
    }
  });
}
