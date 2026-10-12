import { useSyncExternalStore } from 'react';
import { subscribeMotionEnvironment } from '../lib/motion';
export type MotionPreferences = { reduced: boolean; hidden: boolean };
const query = typeof window === 'undefined' ? null : window.matchMedia('(prefers-reduced-motion: reduce)');
const subscribe = (notify: () => void) => query ? subscribeMotionEnvironment(query, document, notify) : () => {};
const snapshot = () => (query?.matches ? 1 : 0) | (typeof document !== 'undefined' && document.hidden ? 2 : 0);
export function useMotionPreferences(): MotionPreferences {
  const flags = useSyncExternalStore(subscribe, snapshot, () => 0);
  return { reduced: !!(flags & 1), hidden: !!(flags & 2) };
}
