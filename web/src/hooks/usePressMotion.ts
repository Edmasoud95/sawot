import { useLayoutEffect, useRef, type RefObject } from 'react';
import { createSpring } from '../lib/spring';
import { useMotionPreferences } from './useMotionPreferences';

/** Visual feedback only: native click, keyboard and recording semantics stay intact. */
export function usePressMotion(ref: RefObject<HTMLButtonElement | null>) {
  const { reduced, hidden } = useMotionPreferences();
  const instant = useRef(reduced || hidden);
  const controller = useRef<ReturnType<typeof createSpring> | null>(null);
  useLayoutEffect(() => {
    instant.current = reduced || hidden;
    if (instant.current) controller.current?.to(1, true);
  }, [reduced, hidden]);
  useLayoutEffect(() => {
    const button = ref.current;
    const artwork = button?.querySelector<HTMLElement>('.motion-control-artwork');
    if (!button || !artwork) return;
    const motion = createSpring(1, value => { artwork.style.transform = `scale(${value})`; });
    controller.current = motion;
    let pressed = false;
    const down = (event: Event) => {
      if (button.disabled || instant.current) return;
      if (event instanceof PointerEvent && (event.button !== 0 || !event.isPrimary)) return;
      if (event instanceof KeyboardEvent && (event.repeat || !['Enter', ' '].includes(event.key))) return;
      pressed = true;
      motion.to(.92);
    };
    const up = () => {
      if (!pressed) return;
      pressed = false;
      motion.to(1, instant.current || button.disabled);
    };
    const keyUp = (event: KeyboardEvent) => { if (['Enter', ' '].includes(event.key)) up(); };
    const cancel = () => { pressed = false; motion.to(1, true); };
    button.addEventListener('pointerdown', down);
    button.addEventListener('keydown', down);
    button.addEventListener('keyup', keyUp);
    window.addEventListener('pointerup', up);
    for (const name of ['pointercancel', 'pointerleave', 'lostpointercapture', 'blur']) button.addEventListener(name, cancel);
    const observer = new MutationObserver(() => { if (button.disabled) cancel(); });
    observer.observe(button, { attributes: true, attributeFilter: ['disabled'] });
    return () => {
      button.removeEventListener('pointerdown', down); button.removeEventListener('keydown', down); button.removeEventListener('keyup', keyUp);
      window.removeEventListener('pointerup', up);
      for (const name of ['pointercancel', 'pointerleave', 'lostpointercapture', 'blur']) button.removeEventListener(name, cancel);
      observer.disconnect(); motion.dispose(); controller.current = null;
    };
  }, [ref]);
}
