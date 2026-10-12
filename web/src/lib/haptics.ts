export type HapticKind = 'selection' | 'confirmation';
type Environment = { enabled(): boolean; visible(): boolean; now(): number; vibrate(ms: number): boolean };
/** Optional tactile feedback, never a prerequisite for completing an action. */
export function createHaptics(environment: Environment) {
  let last = -Infinity;
  let blockers = 0;
  const vibrate = (ms: number) => { try { return environment.vibrate(ms); } catch { return false; } };
  return {
    pulse(kind: HapticKind = 'selection') {
      if (blockers || !environment.enabled() || !environment.visible()) return false;
      const now = environment.now();
      if (now - last < 120) return false;
      last = now;
      return vibrate(kind === 'confirmation' ? 12 : 8);
    },
    /** Covers permission/startup too; each microphone owns an idempotent release. */
    suppress() {
      blockers++;
      vibrate(0);
      let released = false;
      return () => { if (!released) { released = true; blockers--; } };
    },
    cancel() { vibrate(0); },
  };
}
const key = 'sawot-haptics';
const changed = 'sawot-haptics-change';
let override: boolean | undefined;
export function hapticsEnabled() {
  if (override !== undefined) return override;
  try { return localStorage.getItem(key) !== 'off'; } catch { return true; }
}
export function hapticsSupported() { return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'; }
export const haptics = createHaptics({
  enabled: hapticsEnabled,
  visible: () => typeof document !== 'undefined' && !document.hidden,
  now: () => performance.now(),
  vibrate: ms => hapticsSupported() ? navigator.vibrate(ms) : false,
});
export function setHapticsEnabled(enabled: boolean) {
  override = enabled;
  try { localStorage.setItem(key, enabled ? 'on' : 'off'); } catch { /* session preference still works */ }
  if (!enabled) haptics.cancel();
  window.dispatchEvent(new Event(changed));
  if (enabled) haptics.pulse();
}
export function subscribeHaptics(notify: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === key || event.key === null) { override = undefined; notify(); } };
  window.addEventListener(changed, notify);
  window.addEventListener('storage', storage);
  return () => { window.removeEventListener(changed, notify); window.removeEventListener('storage', storage); };
}

/** Existing effort-slider and long-press cues share the device preference and mic guard. */
export function createHapticTick(vibrate?: (duration: number) => unknown, now = () => performance.now()): () => void {
  let lastTick = -Infinity;
  return () => {
    const time = now();
    if (time - lastTick < 45) return;
    lastTick = time;
    if (!vibrate) { haptics.pulse(); return; }
    try { vibrate(8); } catch { /* Optional hardware feedback cannot interrupt an action. */ }
  };
}
