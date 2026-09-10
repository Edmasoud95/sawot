import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import ModelsSection from "./ModelsSection";
import ModelPicker from "./ModelPicker";
import { loadProviderModels } from "./chat/useModels";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { useVoiceStore } from "../store";

function SectionTitle({ children }) {
  return (
    <h3 className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-zinc-500">
      {children}
    </h3>
  );
}

function Toggle({ label, hint, checked, onChange }) {
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

const FIELD_CLS =
  "w-full min-w-0 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[0.85rem] text-zinc-200 outline-none backdrop-blur transition-colors duration-300 hover:border-white/25 focus:border-aurora-teal/50 disabled:opacity-50";

function ProviderRow({ p, onRemove }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5">
      <div className="flex min-w-0 flex-col">
        <span className="flex items-center gap-2 text-[0.85rem] font-medium text-zinc-200">
          {p.name}
          {p.builtin && (
            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[0.55rem] uppercase tracking-wider text-zinc-400">
              built-in
            </span>
          )}
        </span>
        <span className="truncate text-[0.72rem] text-zinc-500">{p.baseUrl}</span>
        <span className={`text-[0.72rem] ${p.state === "error" || p.error ? "text-red-400/90" : "text-zinc-500"}`}>
          {p.state === "pending" ? "Loading models…" : p.error ? "Unreachable — check the URL and key" : `${p.models.length} models`}
        </span>
      </div>
      {!p.builtin && (
        <button
          onClick={() => onRemove(p)}
          aria-label={`Remove provider ${p.name}`}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/10 text-zinc-500 transition-colors duration-300 hover:border-red-400/50 hover:text-red-300"
        >
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      )}
    </div>
  );
}

function AddProviderForm({ apply }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  async function add(e) {
    e.preventDefault();
    setFormError("");
    setBusy(true);
    try {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, baseUrl: url, apiKey: key || undefined }),
      });
      const body = await res.json();
      if (!res.ok) {
        setFormError(body.detail || "Couldn't add the provider — try again.");
        return;
      }
      apply(body);
      setName("");
      setUrl("");
      setKey("");
    } catch {
      setFormError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={add} className="flex flex-col gap-2.5">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name (e.g. OpenRouter)"
        aria-label="Provider name"
        required
        className={FIELD_CLS}
      />
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="Base URL (e.g. https://openrouter.ai/api/v1)"
        aria-label="Provider base URL"
        required
        type="url"
        className={FIELD_CLS}
      />
      <input
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder="API key (optional for local servers)"
        aria-label="Provider API key"
        type="password"
        autoComplete="off"
        className={FIELD_CLS}
      />
      {formError && (
        <p className="text-[0.75rem] leading-snug text-red-400/90">{formError}</p>
      )}
      <button
        type="submit"
        disabled={busy || !name.trim() || !url.trim()}
        className="self-start rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-[0.8rem] text-zinc-200 transition-colors duration-300 hover:border-aurora-teal/50 hover:text-zinc-100 disabled:opacity-50"
      >
        {busy ? "Checking endpoint…" : "Add provider"}
      </button>
    </form>
  );
}

function Select({ label, value, options, onChange, disabled = false }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[0.85rem] font-medium text-zinc-200">{label}</span>
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={FIELD_CLS}
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

function Skeleton() {
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

export default function SettingsPanel() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const panel = useRef(null);
  const scrim = useRef(null);
  const debugEnabled = useVoiceStore((s) => s.debugEnabled);
  const toggleDebug = useVoiceStore((s) => s.toggleDebug);
  const trigger = useRef(null);
  const closeBtn = useRef(null);

  // Park the dialog hidden via GSAP itself, mirroring HistoryDrawer — keeping
  // it mounted lets open/close tween instead of popping in and out.
  useLayoutEffect(() => {
    gsap.set(panel.current, { autoAlpha: 0, y: 14, scale: 0.98 });
  }, []);

  useLayoutEffect(() => {
    gsap.to(panel.current, {
      autoAlpha: open ? 1 : 0,
      y: open ? 0 : 14,
      scale: open ? 1 : 0.98,
      duration: 0.55,
      ease: "power4.out",
    });
    gsap.to(scrim.current, {
      autoAlpha: open ? 1 : 0,
      duration: 0.4,
      ease: "power2.out",
    });
  }, [open]);

  // Settings answer at once with each provider's last known models; then
  // every provider loads on its own so a slow one never blocks the picker.
  // Responses to saves carry the server's cached lists; keep whatever this
  // panel has already loaded so nothing flips back to "loading".
  const mergeSettings = useCallback((body) => setData((prev) => {
    const providers = (body.providers ?? []).map((p) => {
      const known = prev?.providers?.find((q) => q.id === p.id);
      return p.state === "ready" ? p : known && known.state !== "pending" ? { ...p, models: known.models, state: known.state, ...(known.error ? { error: known.error } : {}) } : { ...p, state: "pending" };
    });
    return { ...body, providers };
  }), []);
  const loadToken = useRef(0);
  const refreshProviders = useCallback((providers) => {
    const token = ++loadToken.current;
    for (const p of providers) {
      loadProviderModels(p.id).then((result) => {
        if (token !== loadToken.current) return;
        setData((d) => d && ({ ...d, providers: d.providers.map((q) => (q.id === p.id ? { ...q, ...result } : q)) }));
      });
    }
  }, []);
  useEffect(() => {
    if (!open) return;
    setError("");
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        const providers = (d.providers ?? []).map((p) => ({ ...p, state: p.state === "ready" ? "ready" : "pending" }));
        setData({ ...d, providers });
        refreshProviders(providers);
      })
      .catch(() => setError("Couldn't load settings — is the server running?"));
  }, [open, refreshProviders]);

  const close = useCallback(() => setOpen(false), []);
  useDialogFocus(open, panel, trigger, close);

  async function removeProvider(p) {
    setError("");
    try {
      const res = await fetch(`/api/providers/${p.id}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) {
        setError(body.detail || "Couldn't remove the provider — try again.");
        return;
      }
      mergeSettings(body);
    } catch {
      setError("Couldn't reach the server.");
    }
  }

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
        setError(body.detail || "Couldn't save that change — try again.");
        return;
      }
      mergeSettings(body);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch {
      setError("Couldn't save — is the server running?");
    }
  }

  return (
    <>
      <button
        ref={trigger}
        onClick={() => setOpen(!open)}
        aria-label="Settings"
        title="Settings"
        aria-expanded={open}
        className="header-button"
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
        className="invisible fixed inset-0 z-40 bg-black/50 opacity-0 backdrop-blur-[3px]"
      />
      <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div
          ref={panel}
          inert={!open}
          role="dialog"
          aria-modal="true"
          aria-label="Settings"
          className="settings-panel pointer-events-auto invisible flex max-h-[min(88vh,48rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-ink-900/95 opacity-0 shadow-2xl shadow-black/60 backdrop-blur-2xl"
        >
          <header className="settings-header flex items-center justify-between gap-3">
            <div className="flex items-baseline gap-4">
              <h2 className="text-xl font-medium text-zinc-100">Settings</h2>
              <span
                role="status"
                className={`flex items-center gap-1.5 text-[0.75rem] text-aurora-teal transition-opacity duration-300 ${
                  saved ? "opacity-100" : "opacity-0"
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-aurora-teal" />
                Saved
              </span>
            </div>
            <button
              ref={closeBtn}
              onClick={() => setOpen(false)}
              aria-label="Close settings"
              className="icon-button"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </header>
          {error && (
            <p className="mx-6 mb-3 rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-[0.8rem] text-red-300 sm:mx-10">
              {error}
            </p>
          )}
          <div className="settings-content modal-scroll grid overflow-y-auto">
            <section className="flex min-w-0 flex-col gap-5">
              <SectionTitle>Assistant</SectionTitle>
              {!data && !error && <Skeleton />}
              {data && (
                <>
                  <ModelPicker
                    label="Model"
                    value={data.model}
                    providers={data.providers ?? []}
                    onChange={(model) => update({ model })}
                  />
                  {data.models_error && (
                    <p className="-mt-3 text-[0.75rem] leading-snug text-red-400/90">
                      Can't reach the local model server — showing the last saved model.
                    </p>
                  )}
                  <Select
                    label="Voice"
                    value={data.voice}
                    options={data.voices}
                    onChange={(voice) => update({ voice })}
                  />
                  <Toggle
                    label="Debug bar"
                    hint="A diagnostics strip along the bottom: turn timings, events, raw traffic, and live state."
                    checked={debugEnabled}
                    onChange={() => toggleDebug()}
                  />
                  <Toggle
                    label="Sassy personality"
                    hint="Rita gets witty and teases you. Off is plain and friendly."
                    checked={!!data.sassy}
                    onChange={(sassy) => update({ sassy })}
                  />
                  <Toggle
                    label="Detailed drawings"
                    hint="Lets the model draw with filled shapes (circles, ellipses, rectangles, polygons, arcs) and more strokes. Off keeps simple outlines."
                    checked={!!data.detailedDrawings}
                    onChange={(detailedDrawings) => update({ detailedDrawings })}
                  />
                  <div className="mt-3 flex flex-col gap-3">
                    <SectionTitle>Providers</SectionTitle>
                    {(data.providers ?? []).map((p) => (
                      <ProviderRow key={p.id} p={p} onRemove={removeProvider} />
                    ))}
                    <AddProviderForm apply={(body) => { mergeSettings(body); refreshProviders(body.providers ?? []); }} />
                  </div>
                </>
              )}
            </section>
            <section className="flex min-w-0 flex-col gap-5 border-t border-white/10 pt-6 sm:border-t-0 sm:pt-0">
              <ModelsSection
                active={open}
                onSwitched={() => {
                  // A new speech engine brings its own voice list.
                  fetch("/api/settings").then((r) => r.json()).then(setData).catch(() => {});
                }}
              />
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
