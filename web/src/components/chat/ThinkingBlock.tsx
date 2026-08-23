import { useEffect, useRef, useState } from "react";

// Two lives: while the model is still reasoning (live=true) it's a shimmering
// "Thinking…" header over a dimmed, auto-scrolling transcript; once content
// starts (or the message is persisted) it folds into a one-line disclosure.
export default function ThinkingBlock({ thinking, live = false, seconds = null }) {
  const [open, setOpen] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (live && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [live, thinking]);

  if (!thinking) return null;

  if (live) {
    return (
      <div className="mb-3">
        <p className="thinking-shimmer mb-1.5 font-mono text-[0.65rem] uppercase tracking-[0.25em]">
          Thinking…
        </p>
        <div
          ref={scrollRef}
          className="thinking-fade max-h-28 overflow-y-auto rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 font-mono text-[0.7rem] font-light leading-relaxed text-zinc-600"
        >
          <p className="whitespace-pre-wrap">{thinking}</p>
        </div>
      </div>
    );
  }

  const label = seconds != null ? `Thought for ${seconds}s` : "Thoughts";

  return (
    <div className="mb-3">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 font-mono text-[0.65rem] uppercase tracking-[0.25em] text-zinc-600 transition-colors duration-300 hover:text-zinc-400"
      >
        <svg
          viewBox="0 0 24 24"
          width="10"
          height="10"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          aria-hidden="true"
          className={`transition-transform duration-300 ${open ? "rotate-90" : ""}`}
        >
          <path d="M9 5l7 7-7 7" />
        </svg>
        {label}
      </button>
      {open && (
        <div className="mt-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 font-mono text-[0.7rem] font-light leading-relaxed text-zinc-500">
          <p className="whitespace-pre-wrap">{thinking}</p>
        </div>
      )}
    </div>
  );
}
