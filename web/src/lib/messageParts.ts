export type MessagePart = { type: "thinking" | "content"; text: string };

export function messageParts(message: { parts?: MessagePart[]; thinking?: string; content?: string }): MessagePart[] {
  if (message.parts?.length) return message.parts;
  return [
    ...(message.thinking ? [{ type: "thinking" as const, text: message.thinking }] : []),
    ...(message.content ? [{ type: "content" as const, text: message.content }] : []),
  ];
}

export function appendMessagePart(parts: MessagePart[], type: MessagePart["type"], text: string): MessagePart[] {
  if (!text) return parts;
  const last = parts[parts.length - 1];
  return last?.type === type
    ? [...parts.slice(0, -1), { type, text: last.text + text }]
    : [...parts, { type, text }];
}
