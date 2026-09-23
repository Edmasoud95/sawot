import { useRef, useState, type ReactNode } from "react";

/** Help is a sibling button so expanding a connection never nests controls. */
export default function ConnectionRow({ id, title, summary, open, onToggle, help, children }: {
  id: string; title: string; summary: string; open: boolean; onToggle: () => void;
  help: ReactNode; children: ReactNode;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const info = useRef<HTMLButtonElement>(null);
  return <section className="settings-row" aria-label={title}
    onKeyDown={event => {
      if (event.key === "Escape" && helpOpen) {
        event.preventDefault(); event.stopPropagation(); setHelpOpen(false); info.current?.focus();
      }
    }}>
    <div className="flex items-center gap-1">
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={`${id}-body`}
        className="settings-row-head min-w-0 flex-1">
        <span className="min-w-0 text-base font-medium text-zinc-100">{title}</span>
        <span className="settings-row-summary"><span className="truncate">{summary}</span>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"
            className={`shrink-0 transition-transform duration-300 ${open ? "rotate-90" : ""}`}><path d="M9 6l6 6-6 6" /></svg>
        </span>
      </button>
      <button ref={info} type="button" aria-label={`About ${title}`} aria-expanded={helpOpen} aria-controls={`${id}-help`}
        onClick={() => setHelpOpen(value => !value)}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-aurora-teal">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <circle cx="12" cy="12" r="9" /><path d="M12 11v6" /><circle cx="12" cy="7.5" r=".8" fill="currentColor" stroke="none" />
        </svg>
      </button>
    </div>
    {helpOpen && <div id={`${id}-help`} role="region" aria-label={`${title} help`}
      className="mb-4 space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm leading-relaxed text-zinc-400">{help}</div>}
    {open && <div id={`${id}-body`} className="settings-row-body">{children}</div>}
  </section>;
}
