import type OpenAI from "openai";

// The OpenAI Responses API, spoken through the chat completions shapes the
// rest of the backend already understands. Callers send chat-style messages
// and tools and get back a ChatCompletion (or a stream of ChatCompletionChunk
// objects), so the agent loop and the streaming chat path need no changes.

type Msg = Record<string, any>;

function contentParts(content: any): any {
  if (typeof content === "string" || content == null) return content ?? "";
  if (!Array.isArray(content)) return String(content);
  return content.map((part) => {
    if (part?.type === "text") return { type: "input_text", text: part.text };
    if (part?.type === "image_url") return { type: "input_image", image_url: part.image_url?.url ?? part.image_url };
    return part;
  });
}

/** Chat messages, including assistant tool calls and tool results, as
 *  Responses input items. Item ids are never sent, so historical function
 *  calls are accepted without their original reasoning items. */
export function toResponsesInput(messages: Msg[]): any[] {
  const items: any[] = [];
  for (const m of messages) {
    if (m.role === "tool") {
      items.push({ type: "function_call_output", call_id: m.tool_call_id, output: typeof m.content === "string" ? m.content : JSON.stringify(m.content) });
      continue;
    }
    if (m.role === "assistant") {
      if (m.content) items.push({ role: "assistant", content: typeof m.content === "string" ? m.content : contentParts(m.content) });
      for (const tc of m.tool_calls ?? []) {
        items.push({ type: "function_call", call_id: tc.id, name: tc.function?.name, arguments: tc.function?.arguments ?? "{}" });
      }
      continue;
    }
    items.push({ role: m.role, content: contentParts(m.content) });
  }
  return items;
}

export function toResponsesTools(tools: any[] | undefined): any[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((t) => t.type === "function" && t.function
    ? { type: "function", name: t.function.name, description: t.function.description, parameters: t.function.parameters }
    : t);
}

function usageOf(u: any) {
  return u ? { prompt_tokens: u.input_tokens, completion_tokens: u.output_tokens, total_tokens: u.total_tokens } : undefined;
}

/** A completed Response as a ChatCompletion. */
export function fromResponse(response: any): any {
  const text: string[] = [];
  const reasoning: string[] = [];
  const tool_calls: any[] = [];
  for (const item of response.output ?? []) {
    if (item.type === "message") {
      for (const c of item.content ?? []) if (c.type === "output_text" && c.text) text.push(c.text);
    } else if (item.type === "reasoning") {
      for (const s of item.summary ?? []) if (s.text) reasoning.push(s.text);
    } else if (item.type === "function_call") {
      tool_calls.push({ id: item.call_id, type: "function", function: { name: item.name, arguments: item.arguments ?? "{}" } });
    }
  }
  const message: Msg = { role: "assistant", content: text.length ? text.join("") : null };
  if (reasoning.length) message.reasoning_content = reasoning.join("\n\n");
  if (tool_calls.length) message.tool_calls = tool_calls;
  return {
    id: response.id,
    object: "chat.completion",
    model: response.model,
    choices: [{ index: 0, message, finish_reason: tool_calls.length ? "tool_calls" : "stop" }],
    usage: usageOf(response.usage),
  };
}

/** Responses stream events as ChatCompletionChunk objects. */
export async function* chunksFromEvents(events: AsyncIterable<any>): AsyncGenerator<any> {
  const chunk = (delta: Msg, extra: Msg = {}) => ({ object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: null }], ...extra });
  const slots = new Map<number, number>(); // output_index -> tool call index
  let toolIndex = 0;
  for await (const ev of events) {
    switch (ev.type) {
      case "response.output_text.delta":
        if (ev.delta) yield chunk({ content: ev.delta });
        break;
      case "response.reasoning_summary_text.delta":
      case "response.reasoning_text.delta":
        if (ev.delta) yield chunk({ reasoning_content: ev.delta });
        break;
      case "response.reasoning_summary_part.done":
        yield chunk({ reasoning_content: "\n\n" });
        break;
      case "response.output_item.added":
        if (ev.item?.type === "function_call") {
          const index = toolIndex++;
          slots.set(ev.output_index, index);
          yield chunk({ tool_calls: [{ index, id: ev.item.call_id, type: "function", function: { name: ev.item.name, arguments: "" } }] });
        }
        break;
      case "response.function_call_arguments.delta": {
        const index = slots.get(ev.output_index);
        if (index !== undefined && ev.delta) yield chunk({ tool_calls: [{ index, function: { arguments: ev.delta } }] });
        break;
      }
      case "response.output_item.done":
        // A function call that arrived whole (no argument deltas) still needs its arguments.
        if (ev.item?.type === "function_call" && !slots.has(ev.output_index)) {
          const index = toolIndex++;
          slots.set(ev.output_index, index);
          yield chunk({ tool_calls: [{ index, id: ev.item.call_id, type: "function", function: { name: ev.item.name, arguments: ev.item.arguments ?? "" } }] });
        }
        break;
      case "response.completed":
        yield { object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: slots.size ? "tool_calls" : "stop" }], usage: usageOf(ev.response?.usage) };
        break;
      case "response.failed":
      case "response.incomplete": {
        const reason = ev.response?.error?.message ?? ev.response?.incomplete_details?.reason ?? ev.type;
        throw new Error("Responses API: " + reason);
      }
      case "error":
        throw new Error("Responses API: " + (ev.message ?? ev.error?.message ?? "stream error"));
    }
  }
}

function isReasoningParamRejected(err: unknown): boolean {
  const e = err as any;
  const text = [e?.message, e?.error?.message].filter((s) => typeof s === "string").join(" ");
  return e?.status === 400 && /reasoning|summary/i.test(text) && /unsupported|not support|unknown|invalid/i.test(text);
}

/** chat.completions.create, fulfilled by the Responses API. */
export async function createViaResponses<T = any>(client: OpenAI, params: Record<string, any>): Promise<T> {
  const { model, messages, tools, stream, tool_choice, temperature, max_tokens, max_completion_tokens, reasoning_effort } = params;
  const body: Msg = {
    model,
    input: toResponsesInput(messages ?? []),
    reasoning: { summary: "auto", ...(reasoning_effort && reasoning_effort !== "none" ? { effort: reasoning_effort } : {}) },
  };
  const rtools = toResponsesTools(tools);
  if (rtools) body.tools = rtools;
  if (tool_choice !== undefined) body.tool_choice = tool_choice;
  if (temperature !== undefined) body.temperature = temperature;
  const maxOut = max_completion_tokens ?? max_tokens;
  if (maxOut !== undefined) body.max_output_tokens = maxOut;
  if (stream) body.stream = true;

  const send = async (b: Msg) => (client as any).responses.create(b);
  let result: any;
  try {
    result = await send(body);
  } catch (err) {
    if (!isReasoningParamRejected(err)) throw err;
    const { reasoning: _omit, ...plain } = body;
    result = await send(plain);
  }
  return (stream ? chunksFromEvents(result) : fromResponse(result)) as T;
}
