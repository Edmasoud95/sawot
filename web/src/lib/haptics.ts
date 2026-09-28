/** Brief, optional feedback for discrete control steps. */
export function createHapticTick(vibrate?: (duration: number) => unknown, now = () => performance.now()): () => void {
  let lastTick = -Infinity;
  return () => {
    const time = now();
    if (time - lastTick < 45) return;
    lastTick = time;
    try {
      if (vibrate) vibrate(8);
      else if (typeof navigator !== "undefined") navigator.vibrate?.(8);
    } catch { /* Optional device feedback must never interrupt an interaction. */ }
  };
}
