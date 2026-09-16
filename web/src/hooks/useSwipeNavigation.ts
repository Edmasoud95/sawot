import { useRef, type TouchEvent } from "react";
import { itemAfterSwipe } from "../lib/swipeNavigation";

const INTERACTIVE = 'button, a, input, textarea, select, label, [contenteditable]:not([contenteditable="false"]), [role="slider"], [role="switch"], [role="combobox"], pre, [popover], .dbg-panel';
const modalOpen = (scope?: HTMLElement) => Array.from(document.querySelectorAll(
  'dialog[open], [role="dialog"][aria-modal="true"]:not([inert])',
)).some((dialog) => dialog !== scope);

export function useSwipeNavigation<T extends string>(
  enabled: boolean, current: T, items: readonly T[], onChange: (value: T) => void, withinDialog = false,
) {
  const gesture = useRef<{ id: number; x: number; y: number; time: number; value: T } | null>(null);
  const cancel = () => { gesture.current = null; };

  return {
    onTouchStart: (event: TouchEvent<HTMLElement>) => {
      cancel();
      if (!enabled || !window.matchMedia("(max-width: 639px)").matches || event.touches.length !== 1 || modalOpen(withinDialog ? event.currentTarget : undefined) || window.getSelection()?.toString()) return;
      const target = event.target;
      if (!(target instanceof Element) || target.closest(INTERACTIVE)) return;
      // Preserve horizontal scrolling in chip rows, tables, and other scrollable content.
      for (let el: Element | null = target; el && el !== event.currentTarget; el = el.parentElement) {
        if (el.scrollWidth > el.clientWidth && /auto|scroll/.test(getComputedStyle(el).overflowX)) return;
      }
      const touch = event.touches[0];
      gesture.current = { id: touch.identifier, x: touch.clientX, y: touch.clientY, time: performance.now(), value: current };
    },
    onTouchMove: (event: TouchEvent<HTMLElement>) => {
      const start = gesture.current;
      if (!start) return;
      if (event.touches.length !== 1) { cancel(); return; }
      const touch = event.touches[0];
      const dx = Math.abs(touch.clientX - start.x), dy = Math.abs(touch.clientY - start.y);
      if (dy > 20 && dy > dx) cancel();
    },
    onTouchEnd: (event: TouchEvent<HTMLElement>) => {
      const start = gesture.current;
      cancel();
      if (!start || !enabled || !window.matchMedia("(max-width: 639px)").matches || current !== start.value || event.touches.length || modalOpen(withinDialog ? event.currentTarget : undefined) || window.getSelection()?.toString()) return;
      const touch = Array.from(event.changedTouches).find((touch) => touch.identifier === start.id);
      if (!touch) return;
      const next = itemAfterSwipe(items, current, touch.clientX - start.x, touch.clientY - start.y, performance.now() - start.time);
      if (next !== current) onChange(next);
    },
    onTouchCancel: cancel,
  };
}
