import { useEffect, type RefObject } from "react";

/** Keep keyboard navigation inside an open dialog and restore its trigger. */
export function useDialogFocus(
  open: boolean,
  panel: RefObject<HTMLElement | null>,
  trigger: RefObject<HTMLButtonElement | null>,
  onClose: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const focusable = () => Array.from(panel.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
    ) ?? []).filter((el) => el.getClientRects().length > 0);
    // Let the opening animation make the panel visible before moving focus.
    const frame = requestAnimationFrame(() => focusable()[0]?.focus({ preventScroll: true }));
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key !== "Tab") return;
      const elements = focusable();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (!panel.current?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus({ preventScroll: true });
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      trigger.current?.focus({ preventScroll: true });
    };
  }, [open, panel, trigger, onClose]);
}
