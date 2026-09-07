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

export const SAFE_ID = /^[0-9a-f]{12}$/;
const HISTORY_LIMIT = 30;
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

export function toOpenAiMessages(messages: any[], uploadDir: string): any[] {
  const out: any[] = [];
  for (const m of messages.slice(-HISTORY_LIMIT)) {
    if (m.role === "assistant") {
      out.push({ role: "assistant", content: m.content ?? "" });
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

  create(model: string): any {
    const now = Date.now() / 1000;
    const conv = { id: newId(), title: "New chat", model, created: now, updated: now, messages: [] };
    this.save(conv);
    return conv;
  }

  get(cid: string): any | null {
    const p = this.path(cid);
    if (!existsSync(p)) return null;
    try {
      return JSON.parse(readFileSync(p, "utf8"));
    } catch {
      return null;
    }
  }

  save(conv: any): void {
    writeFileSync(this.path(conv.id), JSON.stringify(conv, null, 2));
  }

  delete(cid: string): void {
    try {
      unlinkSync(this.path(cid));
    } catch {
      /* already gone */
    }
  }

  list(): any[] {
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
        out.push({
          id: conv.id, title: conv.title, model: conv.model,
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

export async function* runChat(
  client: any,
  model: string,
  tools: Tool[],
  systemPrompt: string,
  messages: any[],
  getCards?: (ids: string[]) => Promise<any[]>,
): AsyncGenerator<[string, any]> {
  const convo: any[] = [{ role: "system", content: systemPrompt }, ...messages];
  const touched: string[] = [];
  let finished = false;
  const fullContent: string[] = [];
  const fullThinking: string[] = [];

  const turnStart = performance.now();
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const parser = new ThinkTagParser();
    const contentParts: string[] = [];
    const thinkingParts: string[] = [];
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();

    const roundStart = performance.now();
    const stream = await createChatCompletion<any>(client, {
      model,
      messages: convo,
      tools: toOpenAiTools(tools),
      stream: true,
    });

    for await (const chunk of stream) {
      if (!chunk.choices || !chunk.choices.length) continue;
      const delta = chunk.choices[0].delta;
      const reasoning = (delta as any).reasoning_content;
      if (reasoning) {
        thinkingParts.push(reasoning);
        fullThinking.push(reasoning);
        yield ["thinking", reasoning];
      }
      if (delta.content) {
        for (const [kind, text] of parser.feed(delta.content)) {
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

    for (const [kind, text] of parser.flush()) {
      if (kind === "content") {
        contentParts.push(text);
        fullContent.push(text);
      } else {
        thinkingParts.push(text);
        fullThinking.push(text);
      }
      yield [kind, text];
    }

    const content = contentParts.join("");
    yield ["debug", { event: "llm_round", data: { round: round + 1, latency_ms: Math.round(performance.now() - roundStart),
      tool_calls: toolCalls.size ? [...toolCalls.values()].map((c) => c.name) : null } }];
    if (toolCalls.size === 0) {
      const finalContent = fullContent.join("").trim();
      yield ["debug", { event: "reply", data: { raw: content, text: finalContent, rounds: round + 1,
        latency_ms: Math.round(performance.now() - turnStart) } }];
      yield ["final", {
        content: finalContent,
        thinking: fullThinking.join("").trim(),
      }];
      finished = true;
      break;
    }

    const calls = [...toolCalls.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, c]) => c);
    convo.push({
      role: "assistant",
      content: content || null,
      tool_calls: calls.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: c.arguments },
      })),
    });

    for (const c of calls) {
      let args: any = {};
      let result: any = undefined;
      const toolStart = performance.now();
      try {
        args = JSON.parse(c.arguments || "{}");
      } catch (e: any) {
        result = { error: "invalid tool arguments: " + (e?.message ?? e) };
      }
      yield ["debug", { event: "tool_call", data: { name: c.name, args } }];
      if (result === undefined) {
        result = await executeTool(tools, c.name, args);
      }
      const resultJson = JSON.stringify(result);
      yield ["debug", { event: "tool_result", data: { name: c.name, ok: !(result && typeof result === "object" && "error" in result),
        latency_ms: Math.round(performance.now() - toolStart), size_chars: resultJson.length, result: resultJson.slice(0, 600) } }];
      yield ["tool", { name: c.name, args, result: resultJson.slice(0, 300) }];
      for (const eid of touchedIdsFor(tools, c.name, args, result)) {
        if (!touched.includes(eid)) touched.push(eid);
      }
      convo.push({ role: "tool", tool_call_id: c.id, content: resultJson });
    }
  }

  if (!finished) {
    yield ["final", {
      content: (fullContent.join("") + "\n\nSorry, I couldn't complete that.").trim(),
      thinking: fullThinking.join("").trim(),
    }];
  }

  if (touched.length && getCards) {
    try {
      yield ["entities", await getCards(touched.slice(0, 8))];
    } catch {
      /* cards refresh is best-effort */
    }
  }
}
