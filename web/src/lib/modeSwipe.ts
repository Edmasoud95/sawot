export const MODE_ORDER = ["orb", "cards", "chat"] as const;
export type AppMode = typeof MODE_ORDER[number];

export function modeAfterSwipe(mode: AppMode, dx: number, dy: number, duration: number): AppMode {
  return itemAfterSwipe(MODE_ORDER, mode, dx, dy, duration);
}
import { itemAfterSwipe } from "./swipeNavigation";
