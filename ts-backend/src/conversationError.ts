export function isContextOverflow(error: unknown): boolean {
  const e = error as any;
  const codes = [e?.code, e?.error?.code, e?.error?.error?.code];
  const messages = [e?.message, e?.error?.message, e?.error?.error?.message].filter((v) => typeof v === "string");
  const text = messages.join(" ");
  return codes.some(code => code === "context_length_exceeded" || code === "context_window_exceeded")
    || /maximum context length|context.{0,40}(?:exceed|overflow)|(?:exceed|overflow).{0,40}context|input.{0,30}tokens?.{0,30}(?:exceed|too (?:long|large))/i.test(text);
}

/** Translate context overflow without hiding unrelated provider failures. */
export function conversationErrorMessage(error: unknown, mode: "chat" | "voice" = "chat"): string {
  if (isContextOverflow(error)) {
    const action = mode === "voice" ? "Reconnect voice mode to start a new conversation" : "Start a new conversation";
    return `This conversation is too long for the selected model. ${action}, shorten your message or attachments, or choose a model with a larger context window.`;
  }
  const e = error as any;
  return String(e?.message ?? e?.error?.message ?? e?.error?.error?.message ?? error);
}
