export const FIELD_CLS =
  "w-full min-w-0 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[0.85rem] text-zinc-200 outline-none backdrop-blur transition-colors duration-300 hover:border-white/25 focus:border-aurora-teal/50 disabled:opacity-50";

export const BUTTON_CLS =
  "rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-[0.8rem] text-zinc-200 transition-colors duration-300 hover:border-aurora-teal/50 hover:text-zinc-100 disabled:opacity-50";

export function SectionTitle({ children }) {
  return (
    <h3 className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-zinc-500">
      {children}
    </h3>
  );
}

export function Toggle({ label, hint, checked, onChange }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="flex flex-col gap-1">
        <span className="text-[0.85rem] font-medium text-zinc-200">{label}</span>
        {hint && (
          <span className="text-[0.78rem] leading-snug text-zinc-500">{hint}</span>
        )}
      </span>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors duration-300 ${
          checked ? "bg-aurora-teal/70" : "bg-white/10"
        }`}
      >
        <span
          className={`absolute left-0 top-1 h-4 w-4 rounded-full bg-white shadow transition-transform duration-300 ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}

export function Select({ label, value, options, onChange, disabled = false, labels = null, ariaLabel = label }) {
  return (
    <label className="flex flex-col gap-1.5">
      {label && <span className="text-[0.85rem] font-medium text-zinc-200">{label}</span>}
      <select
        aria-label={ariaLabel}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={FIELD_CLS}
      >
        {options.map((o) => (
          <option key={o} value={o} className="bg-ink-900">
            {labels?.[o] ?? o}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Skeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-4" aria-hidden="true">
      <div className="h-3 w-16 rounded bg-white/10" />
      <div className="h-9 rounded-lg bg-white/5" />
      <div className="h-3 w-16 rounded bg-white/10" />
      <div className="h-9 rounded-lg bg-white/5" />
      <div className="h-3 w-40 rounded bg-white/5" />
    </div>
  );
}

/** A settings row that reads its current value at a glance and expands in
 *  place to reveal the controls. */
export function Disclosure({ id, title, summary, open, onToggle, children }) {
  return (
    <div className="settings-row">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`${id}-body`}
        className="settings-row-head"
      >
        <span className="text-[0.9rem] font-medium text-zinc-100">{title}</span>
        <span className="settings-row-summary">
          <span className="truncate">{summary}</span>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className={`shrink-0 transition-transform duration-300 ${open ? "rotate-90" : ""}`}>
            <path d="M9 6l6 6-6 6" />
          </svg>
        </span>
      </button>
      {open && <div id={`${id}-body`} className="settings-row-body">{children}</div>}
    </div>
  );
}
