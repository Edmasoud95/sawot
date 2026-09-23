export const CHAT_COMMANDS = [
  { name: "/status", description: "Model and conversation context usage" },
  { name: "/help", description: "Show available chat commands" },
] as const;

export function commandSuggestions(text: string) {
  if (!/^\/[a-z]*$/i.test(text)) return [];
  return CHAT_COMMANDS.filter(command => command.name.startsWith(text.toLowerCase()));
}
