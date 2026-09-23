/** Open the mounted settings panel from a contextual setup action. */
export const OPEN_CONNECTIONS_EVENT = "sawot:open-connections";
export function openHomeAssistantSettings(): void {
  window.dispatchEvent(new CustomEvent(OPEN_CONNECTIONS_EVENT, { detail: { connection: "home-assistant" } }));
}
