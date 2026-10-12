import gsap from 'gsap';
import { CustomEase } from 'gsap/CustomEase';

gsap.registerPlugin(CustomEase);
export type MotionRecipe = 'press' | 'release' | 'reveal' | 'surfaceOpen' | 'surfaceClose' | 'navigate' | 'state';
export type MotionTarget = Partial<Record<'x' | 'y' | 'xPercent' | 'scale' | 'autoAlpha', number>>;
export type MotionDriver = {
  to(target: HTMLElement, vars: MotionTarget & { duration: number; ease: string }): { kill(): void };
  set(target: HTMLElement, vars: MotionTarget): void;
};
const eases = new Map<string, string>();
export function readMotionRecipe(element: HTMLElement, recipe: MotionRecipe) {
  const style = element.ownerDocument.defaultView!.getComputedStyle(element);
  const curve = style.getPropertyValue(recipe === 'release' ? '--motion-release-ease' : '--motion-ease').trim();
  let ease = eases.get(curve);
  if (!ease) {
    ease = `sawot-${eases.size}`;
    CustomEase.create(ease, curve || '0.22,1,0.36,1');
    eases.set(curve, ease);
  }
  return { duration: (parseFloat(style.getPropertyValue(`--motion-${recipe}`)) || 0) / 1000, ease };
}

/** Own only this element's tween; state changes retarget from the current frame. */
export function createMotionController(target: HTMLElement, driver: MotionDriver = gsap) {
  let tween: { kill(): void } | undefined;
  let latest: MotionTarget = {};
  let disposed = false;
  return {
    to(vars: MotionTarget, recipe: MotionRecipe, instant: boolean) {
      if (disposed) return;
      tween?.kill();
      latest = { ...vars };
      if (instant) { tween = undefined; driver.set(target, latest); }
      else tween = driver.to(target, { ...latest, ...readMotionRecipe(target, recipe) });
    },
    finish() { if (!disposed) { tween?.kill(); tween = undefined; driver.set(target, latest); } },
    dispose() { disposed = true; tween?.kill(); tween = undefined; },
  };
}
export function shouldReveal(previous: string | number | null, next: string | number | null) {
  return next !== null && previous !== next;
}
export function subscribeMotionEnvironment(query: MediaQueryList, page: Document, notify: () => void) {
  query.addEventListener('change', notify);
  page.addEventListener('visibilitychange', notify);
  return () => { query.removeEventListener('change', notify); page.removeEventListener('visibilitychange', notify); };
}

/** CSS arrivals removed by an environment change must not restart on return. */
export function settleFiniteAnimations(animations: readonly Animation[]) {
  for (const animation of animations) {
    const end = animation.effect?.getComputedTiming().endTime;
    if (typeof end === 'number' && Number.isFinite(end)) animation.finish();
  }
}
