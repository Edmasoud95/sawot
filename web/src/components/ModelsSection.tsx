import { useEffect, useState } from "react";
import { API_BASE } from "../lib/config";

function ModelRow({ m, onDownload }) {
  const pct =
    m.total > 0 ? Math.min(100, Math.round((m.downloaded / m.total) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1.5 border-b border-white/5 pb-2.5 last:border-0">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[0.72rem] text-zinc-300">
          {m.label}
          {m.recommended && (
            <span className="ml-2 rounded-full bg-aurora-teal/15 px-1.5 py-0.5 font-mono text-[0.55rem] uppercase tracking-wider text-aurora-teal">
              recommended
            </span>
          )}
        </span>
        <span className="shrink-0 font-mono text-[0.62rem] text-zinc-500">
          ~{m.size_mb} MB
        </span>
      </div>
      {m.description && (
        <span className="font-mono text-[0.6rem] leading-snug text-zinc-600">
          {m.description}
        </span>
      )}
      <div className="flex items-center gap-2">
        {m.state === "downloaded" ? (
          <span className="font-mono text-[0.65rem] text-aurora-teal">
            ✓ downloaded
          </span>
        ) : m.state === "downloading" ? (
          <div className="flex flex-1 items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full bg-aurora-teal/70 transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="font-mono text-[0.6rem] text-zinc-400">{pct}%</span>
          </div>
        ) : (
          <button
            onClick={() => onDownload(m)}
            className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 font-mono text-[0.62rem] uppercase tracking-wider text-zinc-200 transition-colors hover:border-aurora-teal/50 hover:text-zinc-100"
          >
            {m.state === "error" ? "retry" : "download"}
          </button>
        )}
        {m.error && (
          <span className="font-mono text-[0.6rem] leading-tight text-red-400">
            {m.error}
          </span>
        )}
      </div>
    </div>
  );
}

export default function ModelsSection() {
  const [models, setModels] = useState([]);

  const refresh = () =>
    fetch(`${API_BASE}/api/models`)
      .then((r) => r.json())
      .then((d) => setModels(d.models || []))
      .catch(() => {});

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, []);

  const download = (m) =>
    fetch(`${API_BASE}/api/models/${m.kind}/${m.id}/download`, {
      method: "POST",
    }).then(refresh);

  const stt = models.filter((m) => m.kind === "stt");
  const tts = models.filter((m) => m.kind === "tts");

  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-mono text-[0.62rem] uppercase tracking-[0.22em] text-zinc-500">
        Speech-to-text
      </h3>
      {stt.map((m) => (
        <ModelRow key={m.id} m={m} onDownload={download} />
      ))}
      <h3 className="mt-1 font-mono text-[0.62rem] uppercase tracking-[0.22em] text-zinc-500">
        Text-to-speech
      </h3>
      {tts.map((m) => (
        <ModelRow key={m.id} m={m} onDownload={download} />
      ))}
    </div>
  );
}
