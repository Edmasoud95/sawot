import type OpenAI from "openai";
import { createViaResponses } from "./responsesTransport.js";

// Which request shape a model accepts, learned from provider errors.
//
// Chat completions is the default and what every local server speaks. Some
// hosted reasoning models (OpenAI's gpt-6 family, for one) reject function
// tools on /chat/completions unless reasoning_effort is "none", and some of
// those reject "none" too: they only take tools on the Responses API. No
// models endpoint advertises any of this, so it is learned from the first
// failures and remembered per endpoint and model for the life of the process.

export type Transport = "chat" | "chat-no-reasoning" | "responses";

const transports = new Map<string, Transport>();

function key(client: OpenAI, model: string): string {
  return ((client as any).baseURL ?? "") + "::" + model;
}

function errorText(err: unknown): string {
  const e = err as any;
  return [e?.message, e?.error?.message, e?.error?.error?.message].filter((s) => typeof s === "string").join(" ");
}

/** True for the provider error that says tools and reasoning_effort cannot
 *  be combined on chat completions. */
export function isReasoningToolConflict(err: unknown): boolean {
  const status = (err as any)?.status;
  if (status !== undefined && status !== 400) return false;
  const text = errorText(err);
  return /reasoning[_ ]effort/i.test(text) && /\b(function|tool)s?\b/i.test(text);
}

/** True when the provider rejects reasoning_effort "none" for the model. */
export function isNoneUnsupported(err: unknown): boolean {
  const text = errorText(err);
  return /reasoning[_ ]effort/i.test(text) && /['"]none['"]/i.test(text) && /not support|unsupported/i.test(text);
}

/** Transports learned so far, for diagnostics and tests. */
export function learnedTransports(): Record<string, Transport> {
  return Object.fromEntries(transports);
}

/** Pin a transport ahead of time (a provider known to need the Responses API). */
export function setTransport(client: OpenAI, model: string, transport: Transport): void {
  transports.set(key(client, model), transport);
}

export function resetReasoningFallback(): void {
  transports.clear();
}

/** chat.completions.create through whichever transport the model accepts.
 *  Tries chat completions, then chat completions with reasoning off, then
 *  the Responses API, and remembers the first shape that works. */
export async function createChatCompletion<T = any>(client: OpenAI, params: Record<string, any>): Promise<T> {
  const k = key(client, params.model);
  const viaChat = (body: Record<string, any>) => client.chat.completions.create(body as any) as unknown as Promise<T>;
  const withoutReasoning = { ...params, reasoning_effort: "none" };

  switch (transports.get(k)) {
    case "chat-no-reasoning": return viaChat(withoutReasoning);
    case "responses": return createViaResponses<T>(client, params);
  }

  try {
    return await viaChat(params);
  } catch (err) {
    if (!isReasoningToolConflict(err)) throw err;
    try {
      const result = await viaChat(withoutReasoning);
      transports.set(k, "chat-no-reasoning");
      return result;
    } catch (retryErr) {
      if (!isNoneUnsupported(retryErr)) throw retryErr;
    }
    try {
      const result = await createViaResponses<T>(client, params);
      transports.set(k, "responses");
      return result;
    } catch (responsesErr) {
      throw new Error(
        `${params.model} cannot use tools on chat completions and the Responses API failed too: ${errorText(responsesErr).trim() || String(responsesErr)}`,
      );
    }
  }
}
