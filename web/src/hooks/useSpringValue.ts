import { useLayoutEffect, useRef, type RefObject } from 'react';
import { createSpring } from '../lib/spring';
import { useMotionPreferences } from './useMotionPreferences';

export function useSpringValue(ref: RefObject<HTMLElement | null>, value: number, draw: (element: HTMLElement, value: number) => void) {
  const { reduced, hidden } = useMotionPreferences();
  const paint = useRef(draw); paint.current = draw;
  const initial = useRef(value);
  const spring = useRef<ReturnType<typeof createSpring> | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const controller = createSpring(initial.current, x => paint.current(element, x), { stiffness: 460, damping: 30 });
    spring.current = controller;
    controller.to(initial.current, true);
    return () => { controller.dispose(); spring.current = null; };
  }, [ref]);
  useLayoutEffect(() => { spring.current?.to(value, reduced || hidden); }, [value, reduced, hidden]);
}
