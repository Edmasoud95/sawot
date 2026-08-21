import { useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";

function Toggle({ label, hint, checked, onChange }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="flex flex-col gap-0.5">
        <span className="font-mono text-[0.62rem] uppercase tracking-[0.22em] text-zinc-500">
          {label}
        </span>
        {hint && (
          <span className="font-mono text-[0.58rem] leading-snug text-zinc-600">
            {hint}
          </span>
        )}
      </span>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors duration-300 ${
          checked ? "bg-aurora-teal/70" : "bg-white/10"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-300 ${
            checked ? "translate-x-[18px]" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

function Select({ label, value, options, onChange, disabled }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[0.62rem] uppercase tracking-[0.22em] text-zinc-500">
        {label}
      </span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 font-mono text-[0.8rem] text-zinc-200 outline-none backdrop-blur transition-colors duration-300 hover:border-white/25 focus:border-aurora-teal/50 disabled:opacity-50"
      >
        {options.map((o) => (
          <option key={o} value={o} className="bg-ink-900">
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function SettingsPanel() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const panel = useRef(null);
  const scrim = useRef(null);

  // Park the panel hidden via GSAP itself, mirroring HistoryDrawer — keeping
  // it mounted lets open/close tween instead of popping in and out.
  useLayoutEffect(() => {
    gsap.set(panel.current, { autoAlpha: 0, y: -10 });
  }, []);

  useLayoutEffect(() => {
    gsap.to(panel.current, {
      autoAlpha: open ? 1 : 0,
      y: open ? 0 : -10,
      duration: 0.55,
      ease: "power4.out",
    });
    gsap.to(scrim.current, {
      autoAlpha: open ? 1 : 0,
      duration: 0.4,
      ease: "power2.out",
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setError("");
    fetch("/api/settings")
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setError(String(e)));
  }, [open]);

  async function update(patch) {
    setSaved(false);
    setError("");
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.detail || "save failed");
        return;
      }
      setData(body);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        aria-label="Settings"
        aria-expanded={open}
        className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-zinc-400 backdrop-blur-md transition-colors duration-300 hover:border-white/25 hover:text-zinc-200"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      <div
        ref={scrim}
        onClick={() => setOpen(false)}
        aria-hidden="true"
        className="invisible absolute inset-0 z-20 bg-black/40 opacity-0 backdrop-blur-[2px]"
      />
      <div
        ref={panel}
        className="invisible absolute left-5 top-[calc(64px+env(safe-area-inset-top))] z-40 flex w-[min(85vw,320px)] flex-col gap-4 rounded-2xl border border-white/10 bg-ink-900/90 p-5 opacity-0 backdrop-blur-2xl"
      >
        <h2 className="font-mono text-[0.65rem] font-light uppercase tracking-[0.3em] text-zinc-500">
          Settings
        </h2>
        {!data && !error && (
          <p className="font-mono text-[0.7rem] text-zinc-600">loading…</p>
        )}
        {data && (
          <>
            <Select
              label="Model"
              value={data.model}
              options={data.models.length ? data.models : [data.model]}
              disabled={!data.models.length}
              onChange={(model) => update({ model })}
            />
            {data.models_error && (
              <p className="font-mono text-[0.65rem] text-red-400/90">
                LM Studio unreachable — model list unavailable
              </p>
            )}
            <Select
              label="Voice"
              value={data.voice}
              options={data.voices}
              onChange={(voice) => update({ voice })}
            />
            <Toggle
              label="Sassy personality"
              hint="Rita gets witty and teases you. Off = plain and friendly."
              checked={!!data.sassy}
              onChange={(sassy) => update({ sassy })}
            />
          </>
        )}
        {error && (
          <p className="font-mono text-[0.65rem] text-red-400/90">{error}</p>
        )}
        {saved && (
          <p className="font-mono text-[0.65rem] text-aurora-teal">saved</p>
        )}
      </div>
    </>
  );
}
