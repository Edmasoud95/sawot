import type OpenAI from "openai";

// Some hosted reasoning models (OpenAI's gpt-6 family, for one) reject
// function tools on /chat/completions unless reasoning_effort is "none".
// No models endpoint advertises this, so learn it from the first 400 and
// remember the answer per endpoint and model for the life of the process.

const reasoningOff = new Set<string>();

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

/** Models known to need reasoning turned off, for diagnostics and tests. */
export function reasoningDisabledModels(): string[] {
  return [...reasoningOff];
}

export function resetReasoningFallback(): void {
  reasoningOff.clear();
}

/** chat.completions.create with an automatic one-time retry that switches
 *  reasoning_effort to "none" when the provider demands it, then keeps it
 *  that way for later requests to the same model. */
export async function createChatCompletion<T = any>(client: OpenAI, params: Record<string, any>): Promise<T> {
  const k = key(client, params.model);
  const withoutReasoning = { ...params, reasoning_effort: "none" };
  const create = (body: Record<string, any>) => client.chat.completions.create(body as any) as unknown as Promise<T>;
  if (reasoningOff.has(k)) return create(withoutReasoning);
  try {
    return await create(params);
  } catch (err) {
    if (!isReasoningToolConflict(err)) throw err;
    try {
      const result = await create(withoutReasoning);
      reasoningOff.add(k);
      return result;
    } catch (retryErr) {
      if (!isNoneUnsupported(retryErr)) throw retryErr;
      throw new Error(
        `${params.model} cannot use tools on the chat completions endpoint: the provider requires reasoning_effort "none" ` +
        `for function tools but this model does not accept it. It needs the Responses API, which this backend does not support yet. ` +
        `Pick another model. (${errorText(retryErr).trim()})`,
      );
    }
  }
}
