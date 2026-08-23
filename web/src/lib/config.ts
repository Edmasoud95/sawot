// Frontend base URLs. Override via Vite env (VITE_API_BASE / VITE_WS_BASE)
// to point the UI at a backend hosted on a different origin.
export const API_BASE = import.meta.env.VITE_API_BASE || "";
export const WS_BASE =
  import.meta.env.VITE_WS_BASE ||
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
