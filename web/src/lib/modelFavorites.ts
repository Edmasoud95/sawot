import { useSyncExternalStore } from "react";

const KEY = "sawot-model-favorites";
const listeners = new Set<() => void>();
export function parseModelFavorites(raw: string | null): string[] {
  try {
    const value = JSON.parse(raw ?? "[]");
    return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && id.includes("::")))] : [];
  } catch { return []; }
}
let favorites: string[] = [];
try { favorites = parseModelFavorites(localStorage.getItem(KEY)); } catch { /* Storage may be unavailable. */ }
const notify = () => listeners.forEach(listener => listener());
if (typeof window !== "undefined") window.addEventListener("storage", event => {
  if (event.key !== KEY && event.key !== null) return;
  favorites = parseModelFavorites(event.newValue);
  notify();
});
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useModelFavorites() {
  const values = useSyncExternalStore(subscribe, () => favorites);
  const toggle = (id: string) => {
    favorites = favorites.includes(id) ? favorites.filter(value => value !== id) : [...favorites, id];
    try { localStorage.setItem(KEY, JSON.stringify(favorites)); } catch { /* Keep the selection for this session. */ }
    notify();
  };
  return { favorites: values, toggleFavorite: toggle };
}
