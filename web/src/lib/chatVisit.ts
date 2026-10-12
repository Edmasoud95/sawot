/** Only navigation metadata is stored here; conversation contents stay on the server. */
const KEY = 'sawot-chat-visit';
export const RECENT_CHAT_MS = 30 * 60 * 1000;
export type ChatPosition = { top: number; following: boolean };
export type ChatVisit = { id: string; lastUsed: number; position?: ChatPosition };
export const chatPositions = new Map<string, ChatPosition>();

export function readChatVisit(): ChatVisit | null {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!value || !/^[a-f0-9]{12}$/.test(value.id) || !Number.isFinite(value.lastUsed) || value.lastUsed < 0) return null;
    const position = value.position;
    return { id: value.id, lastUsed: value.lastUsed,
      ...(position && Number.isFinite(position.top) && position.top >= 0 && typeof position.following === 'boolean' ? { position } : {}) };
  } catch { return null; }
}
export function rememberChat(id: string) {
  try { localStorage.setItem(KEY, JSON.stringify({ id, lastUsed: Date.now(), position: chatPositions.get(id) })); }
  catch { /* Storage can be blocked; in-session navigation still works. */ }
}
export function forgetChatVisit(id: string) {
  chatPositions.delete(id);
  if (readChatVisit()?.id === id) try { localStorage.removeItem(KEY); } catch { /* Storage unavailable. */ }
}
