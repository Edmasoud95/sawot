import { useEffect, useId, useRef } from "react";
import { useChatStore } from "../../chatStore";
import { Markdown } from "./Message";

export default function CommandResultDrawer() {
  const result = useChatStore(s => s.commandResult);
  const dismiss = useChatStore(s => s.dismissCommand);
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const open = !!result;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open]);

  if (!result) return null;
  return <dialog ref={dialog} className="model-sheet command-result-drawer" aria-labelledby={title}
    onCancel={event => { event.preventDefault(); dismiss(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dismiss();
    }}>
    <div className="model-sheet-heading">
      <h2 id={title}>/{result.command}</h2>
      <button type="button" aria-label="Close command result" onClick={dismiss}>
        <span className="ui-text-icon" aria-hidden="true">×</span>
      </button>
    </div>
    <div className="command-result-content" aria-live="polite" aria-busy={result.loading}>
      {result.loading ? <p role="status">Loading…</p>
        : result.error ? <p role="alert">{result.error}</p>
          : <Markdown>{result.content}</Markdown>}
    </div>
  </dialog>;
}
