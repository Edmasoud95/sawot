import { useLayoutEffect, useRef, type RefObject } from 'react';
import { createMotionController } from '../lib/motion';
import { useMotionPreferences } from './useMotionPreferences';

type Options = { panel: RefObject<HTMLElement | null>; scrim?: RefObject<HTMLElement | null>; open: boolean; placement: 'left' | 'right' | 'lift'; enabled?: boolean };
export function useSurfaceMotion({ panel, scrim, open, placement, enabled = true }: Options) {
  const { reduced, hidden } = useMotionPreferences();
  const controllers = useRef<{ panel: ReturnType<typeof createMotionController>; scrim?: ReturnType<typeof createMotionController> } | null>(null);
  const previous = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!panel.current) return;
    controllers.current = { panel: createMotionController(panel.current), scrim: scrim?.current ? createMotionController(scrim.current) : undefined };
    previous.current = null;
    return () => { controllers.current?.panel.dispose(); controllers.current?.scrim?.dispose(); controllers.current = null; };
  }, [panel, scrim]);
  useLayoutEffect(() => {
    const controls = controllers.current;
    if (!controls) return;
    const configuration = `${placement}:${enabled}`;
    const closed = { xPercent: placement === 'left' ? -100 : placement === 'right' ? 100 : 0, y: placement === 'lift' ? 24 : 0, scale: 1, autoAlpha: 0 };
    if (previous.current === null && enabled) controls.panel.to(closed, 'surfaceClose', true);
    const instant = reduced || hidden || !enabled || (previous.current !== null && previous.current !== configuration);
    controls.panel.to(!enabled || open ? { xPercent: 0, y: 0, scale: 1, autoAlpha: 1 } : closed, open ? 'surfaceOpen' : 'surfaceClose', instant || previous.current === null && !open);
    controls.scrim?.to({ autoAlpha: enabled && open ? 1 : 0 }, open ? 'surfaceOpen' : 'surfaceClose', instant);
    if (scrim?.current) scrim.current.style.pointerEvents = enabled && open ? 'auto' : 'none';
    previous.current = configuration;
  }, [open, placement, enabled, reduced, hidden, panel, scrim]);
}
