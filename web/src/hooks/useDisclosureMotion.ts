import { useLayoutEffect, useRef, useState } from 'react';
import { useMotionPreferences } from './useMotionPreferences';

/** Keep a closing body only until its height settles; closed content is inert immediately. */
export function useDisclosureMotion(open: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [retained, setRetained] = useState(open);
  const { reduced, hidden } = useMotionPreferences();
  const animation = useRef<Animation | null>(null);
  const wasOpen = useRef(open);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const from = animation.current ? element.getBoundingClientRect().height : wasOpen.current ? element.scrollHeight : 0;
    animation.current?.cancel();
    animation.current = null;
    wasOpen.current = open;
    if (open) setRetained(true);
    if (reduced || hidden) {
      element.style.height = open ? 'auto' : '0px';
      element.style.overflow = open ? 'visible' : 'clip';
      setRetained(open);
      return;
    }
    const to = open ? element.scrollHeight : 0;
    element.style.height = open ? 'auto' : '0px';
    if (from === to) { element.style.overflow = open ? 'visible' : 'clip'; setRetained(open); return; }
    element.style.overflow = 'clip';
    const current = element.animate([{ height: `${from}px`, opacity: open ? .5 : 1 }, { height: `${to}px`, opacity: open ? 1 : 0 }], {
      duration: 360, easing: 'cubic-bezier(.2,.85,.25,1)',
    });
    animation.current = current;
    current.onfinish = () => { animation.current = null; element.style.overflow = open ? 'visible' : 'clip'; if (!open) setRetained(false); };
  }, [open, reduced, hidden]);
  useLayoutEffect(() => () => animation.current?.cancel(), []);
  return { ref, mounted: open || retained, finish: () => animation.current?.finish() };
}
