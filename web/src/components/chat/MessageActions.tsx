import { useEffect, useLayoutEffect, useId, useRef, useState, type RefObject } from "react";
import type { ReadingState } from "../../lib/messageReader";
import { createHapticTick } from "../../lib/haptics";
import { createMessageLongPress, placeMessageMenu, type MessageMenuPoint } from "../../lib/messageLongPress";

const INTERACTIVE = 'a, button, input, textarea, select, summary, [contenteditable], pre, .chat-table-scroll, [role="slider"], [role="button"], svg, canvas';

function Icon({ kind }: { kind: "copy" | "check" | "speaker" | "stop" | "retry" | "edit" | "branch" }) {
  return <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "copy" && <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>}
    {kind === "check" && <path d="m5 12 4 4L19 6" />}
    {kind === "speaker" && <><path d="m11 4-6 5H2v6h3l6 5z" /><path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" /></>}
    {kind === "stop" && <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />}
    {kind === "retry" && <><path d="M20 7v5h-5" /><path d="M20 12a8 8 0 1 0-2.4 5.7M20 7v5" /></>}
    {kind === "edit" && <><path d="m16 3 5 5-12 12-6 1 1-6zM14 5l5 5" /></>}
    {kind === "branch" && <><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="5" r="2" /><path d="M6 7v10M18 7c0 7-12 3-12 10" /></>}
  </svg>;
}

export default function MessageActions({ text, textRef, getSpokenText, reading, onRead, onRegenerate, onEdit, onBranch, branching, disabled }: {
  text: string;
  textRef: RefObject<HTMLElement | null>;
  getSpokenText: () => string;
  reading: ReadingState;
  onRead: (text: string) => void;
  onRegenerate: () => void;
  onEdit?: () => void;
  onBranch: () => void;
  branching: boolean;
  disabled: boolean;
}) {
  const [anchor, setAnchor] = useState<MessageMenuPoint | null>(null);
  const moreOpen = Boolean(anchor);
  const menu = useRef<HTMLDivElement>(null);
  const moreTrigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    const surface = textRef.current;
    if (!surface) return;
    let pointer: number | undefined;
    let opened = false;
    const tick = createHapticTick();
    const gesture = createMessageLongPress(point => {
      opened = true;
      tick();
      setAnchor(point);
    });
    const cancel = () => { gesture.cancel(); surface.classList.remove("message-pressing"); pointer = undefined; };
    const down = (event: PointerEvent) => {
      if (pointer !== undefined) { cancel(); return; }
      if (event.pointerType === "mouse" || !event.isPrimary || event.button !== 0 || !(event.target instanceof Element) || event.target.closest(INTERACTIVE) || window.getSelection()?.toString()) return;
      opened = false;
      pointer = event.pointerId;
      surface.classList.add("message-pressing");
      gesture.start(event.clientX, event.clientY);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerId === pointer) gesture.move(event.clientX, event.clientY);
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return;
      if (opened) {
        if (event.cancelable) event.preventDefault();
        requestAnimationFrame(() => {
          if (menu.current?.matches(":popover-open")) menu.current.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
        });
      }
      cancel();
    };
    const context = (event: MouseEvent) => {
      if (event.target instanceof Element && !event.target.closest(INTERACTIVE) && !window.getSelection()?.toString()) {
        event.preventDefault();
        gesture.cancel();
        if (!opened || pointer === undefined) setAnchor({ x: event.clientX, y: event.clientY });
      }
    };
    const outsideDown = (event: PointerEvent) => { if (pointer !== undefined && event.pointerId !== pointer) cancel(); };
    surface.addEventListener("pointerdown", down);
    surface.addEventListener("contextmenu", context);
    document.addEventListener("pointerdown", outsideDown);
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", cancel);
    document.addEventListener("scroll", cancel, true);
    window.addEventListener("blur", cancel);
    return () => {
      cancel();
      surface.removeEventListener("pointerdown", down);
      surface.removeEventListener("contextmenu", context);
      document.removeEventListener("pointerdown", outsideDown);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", cancel);
      document.removeEventListener("scroll", cancel, true);
      window.removeEventListener("blur", cancel);
    };
  }, [textRef, text]);
  useLayoutEffect(() => {
    if (!anchor || !menu.current) return;
    const element = menu.current;
    element.showPopover();
    const viewport = window.visualViewport;
    const position = placeMessageMenu(anchor, element.offsetWidth, element.offsetHeight, {
      left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0,
      width: viewport?.width ?? innerWidth, height: viewport?.height ?? innerHeight,
    });
    element.style.left = `${position.left}px`;
    element.style.top = `${position.top}px`;
    element.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
    return () => element.hidePopover();
  }, [anchor]);
  useEffect(() => {
    if (!moreOpen) return;
    const close = () => setAnchor(null);
    // Auto popovers dismiss on the release of the touch that opened them.
    // Dismiss on a new outside press so a held message stays open after release.
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !moreTrigger.current?.contains(event.target as Node)) close();
    };
    const scroll = (event: Event) => { if (!menu.current?.contains(event.target as Node)) close(); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", close);
    window.visualViewport?.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", close);
      window.visualViewport?.removeEventListener("resize", close);
      if (menu.current?.contains(document.activeElement)) moreTrigger.current?.focus({ preventScroll: true });
    };
  }, [moreOpen]);
  const runAction = (action: () => void) => { moreTrigger.current?.focus({ preventScroll: true }); setAnchor(null); requestAnimationFrame(action); };
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => { setCopied(false); setError(""); return () => clearTimeout(timer.current); }, [text]);
  const active = reading && reading.phase !== "error";
  const copy = async () => {
    setError("");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard is unavailable in this browser.");
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch { setError("Could not copy. Select the message text to copy it."); }
  };
  return <div className="message-action-group">
    <div className="message-actions" role="group" aria-label="Message actions">
      <button type="button" aria-label={copied ? "Copied" : "Copy message"} title={copied ? "Copied" : "Copy"}
        disabled={!text.trim()} onClick={() => void copy()} data-active={copied}><Icon kind={copied ? "check" : "copy"} /></button>
      <span className="message-secondary-actions"><button type="button" aria-label={active ? "Stop reading" : "Read aloud"} title={active ? "Stop reading" : "Read aloud"}
        aria-pressed={Boolean(active)} disabled={!text.trim() || disabled} onClick={() => onRead(getSpokenText())} data-active={Boolean(active)}>
        {reading?.phase === "loading" ? <span className="message-audio-loading" aria-hidden="true" /> : <Icon kind={active ? "stop" : "speaker"} />}
      </button>
      <button type="button" aria-label="Regenerate answer" title="Regenerate answer" disabled={disabled} onClick={onRegenerate}><Icon kind="retry" /></button>
      <button type="button" aria-label={branching ? "Branching…" : "Branch in new conversation"} title="Branch in new conversation" disabled={disabled} onClick={onBranch}><Icon kind="branch" /></button>
      {onEdit && <button type="button" aria-label="Edit message" title="Edit message" disabled={disabled} onClick={onEdit}><Icon kind="edit" /></button>}</span>
      {active && <button type="button" className="message-mobile-stop" aria-label="Stop reading" onClick={() => onRead(getSpokenText())}><Icon kind="stop" /></button>}
      <button ref={moreTrigger} type="button" className="message-more-trigger" aria-label="More message actions" aria-haspopup="menu" aria-controls={menuId} aria-expanded={moreOpen} onClick={event => {
        const bounds = event.currentTarget.getBoundingClientRect();
        setAnchor({ x: bounds.left + bounds.width / 2, y: bounds.bottom });
      }}><span aria-hidden="true">•••</span></button>
    </div>
    <div ref={menu} id={menuId} popover="manual" className="message-context-menu" role="menu" aria-label="Message actions"
      onToggle={event => { if (event.newState === "closed") setAnchor(null); }}
      onKeyDown={event => {
        if (event.key === "Escape" || event.key === "Tab") {
          if (event.key === "Escape") { event.preventDefault(); moreTrigger.current?.focus({ preventScroll: true }); }
          setAnchor(null); return;
        }
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "ArrowDown" ? (index + 1) % items.length : event.key === "ArrowUp" ? (index - 1 + items.length) % items.length : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : -1;
        if (next >= 0) { event.preventDefault(); items[next]?.focus(); }
      }}>
      <button type="button" role="menuitem" disabled={!text.trim()} onClick={() => runAction(() => void copy())}><Icon kind={copied ? "check" : "copy"} />{copied ? "Copied" : "Copy message"}</button>
      <button type="button" role="menuitem" disabled={!text.trim() || disabled} onClick={() => runAction(() => onRead(getSpokenText()))}><Icon kind={active ? "stop" : "speaker"} />{active ? "Stop reading" : "Read aloud"}</button>
      <button type="button" role="menuitem" disabled={disabled} onClick={() => runAction(onRegenerate)}><Icon kind="retry" />Regenerate answer</button>
      <button type="button" role="menuitem" disabled={disabled} onClick={() => runAction(onBranch)}><Icon kind="branch" />{branching ? "Branching…" : "Branch in new conversation"}</button>
      {onEdit && <button type="button" role="menuitem" disabled={disabled} onClick={() => runAction(onEdit)}><Icon kind="edit" />Edit message</button>}
    </div>
    {branching && <p role="status" className="message-action-error">Creating branch…</p>}
    {(error || reading?.error) && <p role="alert" className="message-action-error">{error || reading?.error}</p>}
  </div>;
}
