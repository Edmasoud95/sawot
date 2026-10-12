import { useLayoutEffect, useRef, type RefObject } from 'react';
import { shouldReveal } from '../lib/motion';
import { useMotionPreferences } from './useMotionPreferences';

/** Native animations leave no transform/containing block behind after arrival. */
export function useArrivalMotion(ref: RefObject<HTMLElement | null>, key: string | number | null, recipe: 'reveal' | 'navigate', direction: -1 | 0 | 1 = 0) {
  const { reduced, hidden } = useMotionPreferences();
  const previous = useRef<string | number | null>(null);
  const animation = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    const changed = shouldReveal(previous.current, key);
    previous.current = key;
    if (reduced || hidden || key === null || changed) { animation.current?.cancel(); animation.current = null; }
    const element = ref.current;
    if (!changed || reduced || hidden || !element) return;
    const style = getComputedStyle(element);
    animation.current = element.animate([
      { opacity: 0, transform: recipe === 'navigate' ? 'none' : 'translateY(10px)' },
      { opacity: 1, transform: 'none' },
    ], { duration: parseFloat(style.getPropertyValue(`--motion-${recipe}`)), easing: `cubic-bezier(${style.getPropertyValue('--motion-ease')})` });
  }, [key, recipe, direction, reduced, hidden, ref]);
  useLayoutEffect(() => () => animation.current?.cancel(), []);
}
