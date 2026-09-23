import type { ContextInfo } from "./providers.js";

export function chatCommand(content: unknown): "status" | "help" | null {
  if (typeof content !== "string") return null;
  const match = /^\/(status|help)$/i.exec(content.trim());
  return match ? match[1].toLowerCase() as "status" | "help" : null;
}

/** A local heuristic, not a provider tokenizer or an enforcement limit.
 * Count the prepared request, never image URLs/base64 as text tokens. */
export function contextEstimate(messages: any[], tools: any[]) {
  const textTokens = (text: string) => Math.ceil(Buffer.byteLength(text, "utf8") / 4);
  let used = 3;
  let images = 0;
  for (const message of messages) {
    used += 6; // Approximate message framing.
    if (typeof message.content === "string") used += textTokens(message.content);
    else if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type === "text") used += textTokens(part.text ?? "");
        else if (part.type === "image_url") { images++; used += 2048; }
      }
    }
  }
  if (tools.length) used += textTokens(JSON.stringify(tools));
  return { used, images };
}

export function statusReply(model: string, provider: string, context: ContextInfo, messages: any[], tools: any[]) {
  const { used, images } = contextEstimate(messages, tools);
  const capacity = context.tokens;
  const remaining = Math.max(0, capacity - used);
  const percent = Math.round(used / capacity * 1000) / 10;
  const source = context.source === "loaded" ? "LM Studio reported, loaded context"
    : context.source === "model" ? "LM Studio reported maximum; model not loaded"
      : "assumed default";
  const n = (value: number) => value.toLocaleString("en-US");
  // Provider/model names are data, not Markdown instructions or links.
  const safe = (value: string) => value.replace(/[\\`*_{}\[\]()<>#!|]/g, "\\$&").replace(/[\r\n]/g, " ");
  const content = [
    "**Chat status**",
    `Model: ${safe(model)}  \nProvider: ${safe(provider)}`,
    `Context: **~${n(used)} / ${n(capacity)} tokens · ${percent}% used** (estimated)  \nRemaining: **~${n(remaining)} tokens**, before reserving room for the reply.  \nCapacity: ${source}.`,
    "Estimate includes current history, instructions, enabled tools, and readable attachments. Text uses a rough byte-based estimate; tokenization varies by model and language.",
    ...(images ? [`Images: ${images}, using a rough allowance of 2,048 tokens each; actual use depends on the model and resolution.`] : []),
    ...(used > capacity ? ["The estimated context is over capacity. Start a new conversation or select a model with a larger context window."] : []),
  ].join("\n\n");
  return { content, status: { model, provider, used, capacity, remaining, percent, source: context.source, estimated: true, images } };
}

export const CHAT_HELP = "**Chat commands**\n\n- `/status` — current model, estimated conversation context used, capacity, and remaining space.\n- `/help` — show these commands.";
