import { MODE_ORDER, type AppMode } from "../lib/modeSwipe";
import { useSwipeNavigation } from "./useSwipeNavigation";

export function useModeSwipe(mobile: boolean, mode: AppMode, setMode: (mode: AppMode) => void) {
  return useSwipeNavigation(mobile, mode, MODE_ORDER, setMode);
}
