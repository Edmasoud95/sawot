const key = "sawot.chat.python";
export function pythonPreference(): boolean {
  try { return localStorage.getItem(key) !== "false"; } catch { return true; }
}
export function savePythonPreference(enabled: boolean): void {
  try { localStorage.setItem(key, String(enabled)); } catch { /* Conversation remains saved on the server. */ }
}
