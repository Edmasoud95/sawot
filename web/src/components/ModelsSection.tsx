import { useEffect, useState } from "react";
import { API_BASE } from "../lib/config";

function ModelCard({ m, onDownload }) {
  const pct =
    m.total > 0 ? Math.min(100, Math.round((m.downloaded / m.total) * 100)) : 0;
  const active = m.active && m.state === "downloaded";
  return (
    <div
      className={`flex flex-col gap-2 rounded-xl border p-4 transition-colors duration-300 ${
        active
          ? "border-aurora-teal/50 bg-aurora-teal/[0.07]"
          : "border-white/10 bg-white/[0.03]"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[0.9rem] font-medium text-zinc-100">
            {m.label}
          </span>
          {m.recommended && (
            <span className="shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[0.55rem] uppercase tracking-wider text-zinc-400">
              recommended
            </span>
          )}
        </span>
        {active && (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-aurora-teal/15 px-2.5 py-1 text-[0.7rem] font-medium text-aurora-teal">
            <span className="h-1.5 w-1.5 rounded-full bg-aurora-teal" />
            Active
          </span>
        )}
      </div>
      {m.description && (
        <span className="text-[0.78rem] leading-snug text-zinc-500">
          {m.description}
        </span>
      )}
      <div className="flex items-center justify-between gap-3 pt-1">
        {m.state === "downloaded" ? (
          <span className="flex items-center gap-1.5 text-[0.78rem] text-zinc-400">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path d="M4 12.5l5 5L20 6.5" />
            </svg>
            Downloaded
          </span>
        ) : m.state === "downloading" ? (
          <div className="flex flex-1 items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full bg-aurora-teal/70 transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="font-mono text-[0.65rem] text-zinc-400">{pct}%</span>
          </div>
        ) : (
          <button
            onClick={() => onDownload(m)}
            className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[0.78rem] text-zinc-200 transition-colors hover:border-aurora-teal/50 hover:text-zinc-100"
          >
            {m.state === "error" ? "Retry download" : "Download"}
          </button>
        )}
        <span className="shrink-0 font-mono text-[0.65rem] text-zinc-500">
          ~{m.size_mb} MB
        </span>
      </div>
      {m.error && (
        <span className="text-[0.75rem] leading-tight text-red-400">{m.error}</span>
      )}
    </div>
  );
}

export default function ModelsSection({ active = true }) {
  const [models, setModels] = useState([]);

  const refresh = () =>
    fetch(`${API_BASE}/api/models`)
      .then((r) => r.json())
      .then((d) => setModels(d.models || []))
      .catch(() => {});

  // Poll only while the settings dialog is open — downloads keep running
  // server-side either way, so there is nothing to watch when hidden.
  useEffect(() => {
    if (!active) return;
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [active]);

  const download = (m) =>
    fetch(`${API_BASE}/api/models/${m.kind}/${m.id}/download`, {
      method: "POST",
    }).then(refresh);

  const stt = models.filter((m) => m.kind === "stt");
  const tts = models.filter((m) => m.kind === "tts");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h3 className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-zinc-500">
          Speech-to-text
        </h3>
        {stt.map((m) => (
          <ModelCard key={m.id} m={m} onDownload={download} />
        ))}
      </div>
      <div className="flex flex-col gap-3">
        <h3 className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-zinc-500">
          Text-to-speech
        </h3>
        {tts.map((m) => (
          <ModelCard key={m.id} m={m} onDownload={download} />
        ))}
      </div>
    </div>
  );
}
