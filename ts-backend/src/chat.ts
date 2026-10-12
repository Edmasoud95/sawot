import { analysisHistory } from "./analysis/context.js";
import { presentationHistory, searchPageKind, citedProductIds } from "./resultPresentation.js";
import { isDeepSeekEndpoint } from "./effort.js";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { extname, join } from "node:path";

import { executeTool, toOpenAiTools, touchedIdsFor, type Tool } from "./tools.js";
import { createChatCompletion } from "./reasoningFallback.js";
import type { EffortLevel } from "./effort.js";
import { voiceSearchSources } from "./search.js";
import { FINAL_ANSWER_PROMPT, FINAL_ANSWER_ERROR } from "./toolBudget.js";
import { ToolMarkupFilter, TOOL_MARKUP_ERROR, toolMarkupRecovery } from "./toolMarkup.js";

export const SAFE_ID = /^[0-9a-f]{12}$/;
const MAX_ROUNDS = 5;
const FENCE = "```";

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".pdf": "application/pdf",
};

export function newId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

function findFile(dir: string, prefix: string, excludeSuffix?: string): string | null {
  try {
    for (const e of readdirSync(dir)) {
      if (!e.startsWith(prefix + ".")) continue;
      if (excludeSuffix && e.endsWith(excludeSuffix)) continue;
      return e;
    }
  } catch {
    /* dir missing */
  }
  return null;
}

export function toOpenAiMessages(messages: any[], uploadDir: string, preserveThinking = false): any[] {
  const out: any[] = [];
  for (const m of messages) {
    if (m.command) continue;
    if (m.role === "assistant") {
      out.push({ role: "assistant", content: (m.content ?? "") + presentationHistory(m.search) + analysisHistory(m.analysis), ...(preserveThinking && m.thinking ? { reasoning_content: m.thinking } : {}) });
      continue;
    }
    let text = m.content ?? "";
    const images: any[] = [];
    for (const a of m.attachments ?? []) {
      if (!SAFE_ID.test(String(a.id ?? ""))) continue;
      const file = findFile(uploadDir, String(a.id));
      const path = file ? join(uploadDir, file) : null;
      if (a.kind === "pdf") {
        const sidecar = join(uploadDir, String(a.id) + ".pdftxt");
        const body = existsSync(sidecar)
          ? readFileSync(sidecar, "utf8").slice(0, 50000)
          : "(attachment missing)";
        text += "\n\n" + FENCE + a.name + "\n" + body + "\n" + FENCE;
      } else if (a.kind === "text") {
        const body = path ? readFileSync(path, "utf8").slice(0, 50000) : "(attachment missing)";
        text += "\n\n" + FENCE + a.name + "\n" + body + "\n" + FENCE;
      } else if (a.kind === "image" && path) {
        const b64 = readFileSync(path).toString("base64");
        const mime = MIME[extname(path).toLowerCase()] ?? "image/png";
        images.push({ type: "image_url", image_url: { url: "data:" + mime + ";base64," + b64 } });
      }
    }
    if (images.length) {
      out.push({ role: "user", content: [{ type: "text", text }, ...images] });
    } else {
      out.push({ role: "user", content: text });
    }
  }
  return out;
}

export class ChatStore {
  private root: string;

  constructor(root: string) {
    this.root = root;
    mkdirSync(root, { recursive: true });
  }

  private path(cid: string): string {
    return join(this.root, cid + ".json");
  }

  create(model: string, homeAssistant = false, webSearch = true, python = true): any {
    const now = Date.now() / 1000;
    const conv = { id: newId(), title: "New chat", reasoningEffort: null, model, homeAssistant, webSearch, python, created: now, updated: now, messages: [] };
    this.save(conv);
    return conv;
  }

  get(cid: string): any | null {
    const p = this.path(cid);
    if (!existsSync(p)) return null;
    try {
      const conv = JSON.parse(readFileSync(p, "utf8"));
      conv.messages = (conv.messages ?? []).filter((m: any) => !m.command);
      // Older conversations predate URL classification. Derive it on read so
      // saved direct-product cards survive the stricter presentation rules.
      for (const message of conv.messages) {
        if (!Array.isArray(message.search?.sources)) continue;
        for (const source of message.search.sources) {
          if (!source || typeof source.url !== 'string') continue;
          const kind = searchPageKind(source.url);
          if (kind !== 'unknown' || source.pageKind !== undefined) source.pageKind = kind;
        }
      }
      conv.homeAssistant = Boolean(conv.homeAssistant);
      conv.webSearch = conv.webSearch !== false;
      conv.python = conv.python !== false;
      conv.reasoningEffort ??= null;
      return conv;
    } catch {
      return null;
    }
  }

  save(conv: any): void {
    if (this.get(conv.id)?.privateMemoryUsed) conv.privateMemoryUsed = true;
    writeFileSync(this.path(conv.id), JSON.stringify(conv, null, 2));
  }

  delete(cid: string, uploadDir?: string): void {
    if (!SAFE_ID.test(cid)) throw new Error("Invalid conversation ID");
    const path = this.path(cid);
    if (!existsSync(path)) return;
    // Read raw records, including hidden drafts and legacy command attachments.
    const ids = (conv: any): Set<string> => new Set([
      ...(conv.uploadIds ?? []),
      ...(conv.messages ?? []).flatMap((m: any) => (m.attachments ?? []).map((a: any) => a.id)),
    ].filter((id: unknown) => typeof id === "string" && SAFE_ID.test(id)));
    const owned = ids(JSON.parse(readFileSync(path, "utf8")));
    if (uploadDir && owned.size) {
      // Fail before removing anything if another record cannot be read safely.
      for (const file of readdirSync(this.root)) {
        if (!file.endsWith(".json") || file === cid + ".json") continue;
        for (const id of ids(JSON.parse(readFileSync(join(this.root, file), "utf8")))) owned.delete(id);
      }
      const files = existsSync(uploadDir) ? readdirSync(uploadDir) : [];
      for (const file of files) {
        if (!owned.has(file.split(".")[0])) continue;
        try { unlinkSync(join(uploadDir, file)); }
        catch (error: any) { if (error.code !== "ENOENT") throw error; }
      }
    }
    // Keep the record on cleanup failure so deletion can be retried.
    unlinkSync(path);
  }

  list(query = ""): any[] {
    const needle = query.trim().toLocaleLowerCase();
    const out: any[] = [];
    let entries: string[] = [];
    try {
      entries = readdirSync(this.root);
    } catch {
      return out;
    }
    for (const f of entries) {
      if (!f.endsWith(".json")) continue;
      try {
        const conv = JSON.parse(readFileSync(join(this.root, f), "utf8"));
        const hasMessages = (conv.messages ?? []).some((m: any) => m.role === "user" && !m.command);
        const draftText = String(conv.draftText ?? "").trim();
        if (!hasMessages && draftText.split(/\s+/u).filter(Boolean).length < 3) continue;
        const title = hasMessages ? conv.title : `Draft: ${draftText.replace(/\s+/gu, " ").slice(0, 80)}`;
        const texts = [String(title ?? ""), draftText, ...(conv.messages ?? [])
          .filter((m: any) => ["user", "assistant"].includes(m.role) && !m.command && typeof m.content === "string")
          .map((m: any) => m.content)].map((text: string) => text.replace(/\s+/gu, " ").trim());
        const match = needle ? texts.find(text => text.toLocaleLowerCase().includes(needle)) : undefined;
        if (needle && match === undefined) continue;
        const at = match?.toLocaleLowerCase().indexOf(needle) ?? 0;
        const start = Math.max(0, at - 40);
        const excerpt = match === undefined ? undefined : `${start ? "…" : ""}${match.slice(start, start + 156)}${match.length > start + 156 ? "…" : ""}`;
        out.push({
          id: conv.id,
          title,
          ...(excerpt !== undefined ? { excerpt } : {}),
          isDraft: !hasMessages,
          model: conv.model,
          reasoningEffort: conv.reasoningEffort ?? null,
          homeAssistant: Boolean(conv.homeAssistant),
          webSearch: conv.webSearch !== false,
          python: conv.python !== false,
          created: conv.created, updated: conv.updated,
        });
      } catch {
        /* corrupt file */
      }
    }
    return out.sort((a, b) => b.updated - a.updated);
  }
}

export class ThinkTagParser {
  private static OPEN = "<think>";
  private static CLOSE = "</think>";

  private inThink = false;
  private buf = "";

  feed(text: string): Array<["thinking" | "content", string]> {
    this.buf += text;
    const out: Array<["thinking" | "content", string]> = [];
    const kind = (): "thinking" | "content" => (this.inThink ? "thinking" : "content");
    while (this.buf) {
      const tag = this.inThink ? ThinkTagParser.CLOSE : ThinkTagParser.OPEN;
      const idx = this.buf.indexOf(tag);
      if (idx !== -1) {
        if (idx) out.push([kind(), this.buf.slice(0, idx)]);
        this.buf = this.buf.slice(idx + tag.length);
        this.inThink = !this.inThink;
        continue;
      }
      let keep = 0;
      for (let k = Math.min(tag.length - 1, this.buf.length); k > 0; k--) {
        if (tag.startsWith(this.buf.slice(-k))) {
          keep = k;
          break;
        }
      }
      const emitLen = this.buf.length - keep;
      if (emitLen) {
        out.push([kind(), this.buf.slice(0, emitLen)]);
        this.buf = this.buf.slice(emitLen);
      }
      break;
    }
    return out;
  }

  flush(): Array<["thinking" | "content", string]> {
    const out: Array<["thinking" | "content", string]> = [];
    if (this.buf) out.push([this.inThink ? "thinking" : "content", this.buf]);
    this.buf = "";
    return out;
  }
}

export interface ChatContextHooks {
  /** Refresh mutable personal context immediately before each inference. */
  prepare: (messages: any[]) => Promise<{ suffix: string; submitted: () => Promise<void> }>;
}

export async function* runChat(
  client: any,
  model: string,
  tools: Tool[],
  systemPrompt: string,
  messages: any[],
  getCards?: (ids: string[]) => Promise<any[]>,
  reasoningEffort?: EffortLevel | null,
  signal?: AbortSignal,
  contextHooks?: ChatContextHooks,
): AsyncGenerator<[string, any]> {
  const convo: any[] = [{ role: "system", content: systemPrompt }, ...messages];
  const touched: string[] = [];
  const cards = new Map<string, any>();
  const fullContent: string[] = [];
  const fullThinking: string[] = [];
  const sources = new Map<string, ReturnType<typeof voiceSearchSources>[number] & { id: string }>();
  const selectable = tools.some(tool => tool.name === 'web_search');
  let presentations: { kind: 'products' | 'news'; ids: string[] }[] = [];
  let productSelectionRequested = false;
  const presentationState = () => selectable ? { presentationVersion: 1, presentations, ...(productSelectionRequested ? {productSearch: true} : {}) } : {};
  if (selectable) tools = [...tools, {
    name: 'present_results',
    description: 'Show only the chosen search results as product or news cards. Choose their short result IDs, such as r1 and r3. The app supplies all card details. Blocked pages use search details only; prices and availability are unverified. No card JSON in your answer.',
    parameters: { type: 'object', properties: { kind: {type: 'string', enum: ['products', 'news']}, ids: {type: 'array', items: {type: 'string'}, minItems: 1, maxItems: 12} }, required: ['kind', 'ids'], additionalProperties: false },
    handler: async args => {
      if (!args || !['products', 'news'].includes(args.kind) || !Array.isArray(args.ids) || !args.ids.length || args.ids.length > 12 ||
          Object.keys(args).some(key => !['kind', 'ids'].includes(key)) || args.ids.some(id => typeof id !== 'string' || ![...sources.values()].some(source => source.id === id)))
        return { error: 'Select 1 to 12 existing result IDs with kind products or news. Do not invent IDs, URLs or card fields.' };
      const ids = [...new Set<string>(args.ids)];
      if (args.kind === 'products') {
        productSelectionRequested = true;
        const rejected = [...sources.values()].filter(source => ids.includes(source.id) && searchPageKind(source.url) !== 'product');
        if (rejected.length) return {
          error: 'These IDs are search/category pages or unknown page types, not confirmed individual product routes. Products mentioned in their snippets are not the linked page. Choose relevant direct_product_ids, or call web_search with kind products. Do not present listing pages as products.',
          rejected_ids: rejected.map(source => source.id),
          direct_product_ids: [...sources.values()].filter(source => searchPageKind(source.url) === 'product').map(source => source.id),
        };
      }
      presentations = [...presentations.filter(group => group.kind !== args.kind), {kind: args.kind, ids}];
      return { shown: ids, kind: args.kind, instruction: 'The app displays these results. Explain your recommendation in normal prose; do not write card markup or repeat the list.' };
    },
  }];
  let blockedRetry = false;
  const blockedPages = new Map<string, any>();
  const pageKey = (raw: unknown) => { try { const url = new URL(String(raw)); url.hash = ''; return url.href; } catch { return ''; } };
  const blockedAnswerPrompt = '\n\nA blocked page was requested again. Tools are now unavailable for this turn. Finish using the results already collected. Give relevant links, explain that the page could not be read, and do not invent its contents.';

  // A failed final inference must not discard sources already retrieved. Only
  // use this turn's source registry, never URLs from malformed model output.
  function* finishWithSources(reason: string): Generator<[string, any]> {
    const all = [...sources.values()].filter(source => !productSelectionRequested || searchPageKind(source.url) === 'product');
    const selectedIds = new Set(presentations.flatMap(group => group.ids));
    const selected = all.filter(source => selectedIds.has(source.id));
    const blocked = all.filter(source => source.blocked);
    const chosen = (selected.length ? selected : blocked.length ? blocked : all).slice(0, 6);
    const links = chosen.map(source => {
      const title = source.title.replace(/[\\[\]]/g, '\\$&').replace(/\s+/g, ' ');
      const url = source.url.replace(/[()<>\s]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase());
      return `- [${title}](${url})${source.blocked ? ' — I could not read this page.' : ''}`;
    });
    const fallback = links.length
      ? '\n\nI couldn’t finish the answer. Here are links found during this search; their details have not been verified:\n\n' + links.join('\n')
      : '\n\nI couldn’t find an individual product link. The retrieved links were search or category pages.';
    yield ['debug', { event: 'source_link_fallback', data: { reason, sources: chosen.length } }];
    yield ['content', fallback];
    yield ['final', { content: (fullContent.join('') + fallback).trim(), thinking: fullThinking.join('').trim() }];
  }

  const turnStart = performance.now();
  let repairedMarkup = false;
  let repairPrompt = "";
  let budgetReported = false;
  for (let round = 0; round <= MAX_ROUNDS; round++) {
    signal?.throwIfAborted();
    const answerOnly = blockedRetry || round === MAX_ROUNDS;
    if (round === MAX_ROUNDS && !budgetReported) {
      budgetReported = true;
      yield ["debug", { event: "tool_budget_exhausted", data: { rounds: MAX_ROUNDS } }];
      convo[0] = { role: "system", content: systemPrompt + FINAL_ANSWER_PROMPT };
      signal?.throwIfAborted();
    }
    const parser = new ThinkTagParser();
    const markup = new ToolMarkupFilter();
    const contentParts: string[] = [];
    const thinkingParts: string[] = [];
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();

    const roundStart = performance.now();
    const context = await contextHooks?.prepare(convo);
    convo[0] = { role: "system", content: systemPrompt + (context?.suffix ?? "") + (blockedRetry ? blockedAnswerPrompt : answerOnly ? FINAL_ANSWER_PROMPT : "") + repairPrompt };
    signal?.throwIfAborted();
    const stream = await createChatCompletion<any>(client, {
      model,
      ...(reasoningEffort != null ? { reasoning_effort: reasoningEffort } : {}),
      messages: convo,
      ...(!answerOnly && tools.length ? { tools: toOpenAiTools(tools) } : {}),
      stream: true,
    }, { preserveReasoning: true, signal });
    await context?.submitted();

    for await (const chunk of stream) {
      signal?.throwIfAborted();
      if (!chunk.choices || !chunk.choices.length) continue;
      const delta = chunk.choices[0].delta;
      const reasoning = (delta as any).reasoning_content;
      if (reasoning) {
        thinkingParts.push(reasoning);
        fullThinking.push(reasoning);
        yield ["thinking", reasoning];
      }
      if (delta.content) {
        for (const [kind, parsed] of parser.feed(delta.content)) {
          const text = kind === "content" ? markup.feed(parsed) : parsed;
          if (!text) continue;
          if (kind === "content") {
            contentParts.push(text);
            fullContent.push(text);
          } else {
            thinkingParts.push(text);
            fullThinking.push(text);
          }
          yield [kind, text];
        }
      }
      for (const tc of delta.tool_calls ?? []) {
        const slot = toolCalls.get(tc.index) ?? { id: "", name: "", arguments: "" };
        if (tc.id) slot.id = tc.id;
        if (tc.function?.name) slot.name = tc.function.name;
        if (tc.function?.arguments) slot.arguments += tc.function.arguments;
        toolCalls.set(tc.index, slot);
      }
    }

    for (const [kind, parsed] of parser.flush()) {
      const text = kind === "content" ? markup.feed(parsed) : parsed;
      if (!text) continue;
      if (kind === "content") {
        contentParts.push(text);
        fullContent.push(text);
      } else {
        thinkingParts.push(text);
        fullThinking.push(text);
      }
      yield [kind, text];
    }
    const tail = markup.flush();
    if (tail) {
      contentParts.push(tail);
      fullContent.push(tail);
      yield ["content", tail];
    }

    const content = contentParts.join("");
    yield ["debug", { event: "llm_round", data: { round: round + 1, latency_ms: Math.round(performance.now() - roundStart),
      tool_calls: toolCalls.size ? [...toolCalls.values()].map((c) => c.name) : null } }];
    if (markup.detected) {
      yield ["debug", { event: "tool_markup_rejected", data: { round: round + 1, answerOnly } }];
      if (toolCalls.size === 0 && !blockedRetry) {
        if (repairedMarkup) {
          if (!sources.size) throw new Error(TOOL_MARKUP_ERROR);
          yield* finishWithSources('invalid_tool_markup');
          break;
        }
        repairedMarkup = true;
        repairPrompt = toolMarkupRecovery(answerOnly || tools.length === 0);
        // Retry inference only, preserving tool results. No tool handlers are replayed.
        round--;
        continue;
      }
    }
    repairPrompt = "";
    // Some compatible providers may still return calls without tool definitions.
    // Never execute them beyond the budget or accept an empty final response.
    if (answerOnly && (toolCalls.size > 0 || !content.trim() || (blockedRetry && markup.detected))) {
      if (!sources.size) throw new Error(FINAL_ANSWER_ERROR);
      yield* finishWithSources(blockedRetry ? 'blocked_page_retry' : 'tool_budget_exhausted');
      break;
    }
    if (toolCalls.size === 0) {
      const finalContent = fullContent.join("").trim();
      if (selectable && !presentations.some(group => group.kind === 'products')) {
        const ids = citedProductIds(finalContent, [...sources.values()]);
        if (ids.length) {
          presentations = [...presentations, {kind: 'products', ids}];
          yield ['search', {tool: 'web_search', phase: 'complete', sources: [...sources.values()], ...presentationState()}];
        }
      }
      yield ["debug", { event: "reply", data: { raw: content, text: finalContent, rounds: round + 1,
        latency_ms: Math.round(performance.now() - turnStart) } }];
      yield ["final", {
        content: finalContent,
        thinking: fullThinking.join("").trim(),
      }];
      break;
    }

    const calls = [...toolCalls.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, c]) => c);
    convo.push({
      role: "assistant",
      content: content || null,
      ...(isDeepSeekEndpoint(client.baseURL) ? { reasoning_content: thinkingParts.join("") } : {}),
      tool_calls: calls.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: c.arguments },
      })),
    });

    for (const c of calls) {
      signal?.throwIfAborted();
      let args: any = {};
      let result: any = undefined;
      const toolStart = performance.now();
      const webTool = ["web_search", "fetch_page", "find_in_page"].includes(c.name);
      const memoryTool = ["save_memory", "update_memory", "search_memories", "delete_memory"].includes(c.name);
      try {
        args = JSON.parse(c.arguments || "{}");
      } catch (e: any) {
        result = { error: "invalid tool arguments: " + (e?.message ?? e) };
      }
      if (webTool) yield ["search", { tool: c.name, phase: "start", sources: [...sources.values()],
        ...presentationState(),
        ...(c.name === "web_search" && typeof args?.query === "string" && args.query.trim()
          ? { query: args.query.trim() } : {}),
      }];
      yield ["debug", { event: "tool_call", data: { name: c.name, args: memoryTool ? { redacted: true } : args } }];
      if (result === undefined) {
        const blocked = ['fetch_page', 'find_in_page', 'download_file'].includes(c.name) && blockedPages.get(pageKey(args?.url));
        result = blocked ? {...blocked, retryBlocked: true} : await executeTool(tools, c.name, args);
      }
      if (result?.link_only && result.status === 403) {
        const repeated = result.retryBlocked && [args?.url, result.url, result.blocked_url].some(raw => blockedPages.has(pageKey(raw)));
        for (const raw of [args?.url, result.url, result.blocked_url]) { const key = pageKey(raw); if (key) blockedPages.set(key, result); }
        if (repeated) {
          blockedRetry = true;
          yield ['debug', { event: 'blocked_page_retry_stopped', data: {url: result.url} }];
        }
      }
      if (webTool) {
        if (c.name === 'web_search' && (args?.kind === 'products' || result?.productSearch === true)) productSelectionRequested = true;
        for (const source of voiceSearchSources(c.name, result)) {
          const previous = sources.get(source.url);
          if (!previous && sources.size >= 40) continue;
          sources.set(source.url, { ...previous, ...source, id: previous?.id ?? `r${sources.size + 1}`,
            ...(source.blocked && previous ? { title: previous.title } : {}),
            read: source.blocked ? false : previous?.read || source.read });
        }
        if (c.name === 'web_search' && Array.isArray(result?.results)) result = { ...result, results: result.results.map((page: any) => {
          let id: string | undefined;
          try { const url = new URL(page.url); url.hash = ''; id = sources.get(url.href)?.id; } catch { /* Invalid results cannot be selected. */ }
          const {thumbnail: _thumbnail, ...details} = page;
          return {...details, id, page_kind: searchPageKind(page.url)};
        }) };
        yield ["search", { tool: c.name, phase: result?.error ? "error" : "complete", sources: [...sources.values()], ...presentationState() }];
      }
      if (c.name === 'present_results') yield ['search', {tool: 'web_search', phase: 'complete', sources: [...sources.values()], ...presentationState()}];
      const resultJson = JSON.stringify(result);
      yield ["debug", { event: "tool_result", data: { name: c.name, ok: !(result && typeof result === "object" && "error" in result),
        latency_ms: Math.round(performance.now() - toolStart), size_chars: resultJson.length, result: memoryTool ? "[memory result redacted]" : resultJson.slice(0, 600) } }];
      if (!memoryTool) yield ["tool", { name: c.name, args, result: resultJson.slice(0, 300) }];
      const changed = touchedIdsFor(tools, c.name, args, result);
      for (const eid of changed) {
        if (!touched.includes(eid) && touched.length < 30) touched.push(eid);
      }
      if (changed.length && getCards) {
        try {
          const refreshed = await getCards(changed.filter(id => touched.includes(id)));
          for (const card of refreshed) if (touched.includes(card.entity_id)) cards.set(card.entity_id, card);
          yield ["entities", touched.flatMap(id => cards.has(id) ? [cards.get(id)] : [])];
        } catch { signal?.throwIfAborted(); /* Card refresh remains best-effort. */ }
      }
      convo.push({ role: "tool", tool_call_id: c.id, content: resultJson });
    }
  }
}
