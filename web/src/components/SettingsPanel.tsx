import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import ModelsSection from "./ModelsSection";
import ModelPicker from "./ModelPicker";
import { loadProviderModels } from "./chat/useModels";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { useRecorder } from "../hooks/useRecorder";
import { useVoiceStore } from "../store";
import { BUTTON_CLS, FIELD_CLS, SectionTitle, Select, Skeleton, Toggle } from "./settings/fields";
import GeneralSection from "./settings/GeneralSection";

const PERSONALITY_OPTIONS = [
  { value: "sassy", label: "Sassy", hint: "Rita gets witty and teases you." },
  { value: "plain", label: "Plain", hint: "Friendly and to the point." },
  { value: "custom", label: "Custom", hint: "Describe the character yourself, or let the model write it." },
];

function Personality({ value, prompt, onChange }) {
  const [draft, setDraft] = useState(prompt ?? "");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  // A save from elsewhere (or first load) refreshes the draft; typing does not.
  useEffect(() => { setDraft(prompt ?? ""); }, [prompt]);
  const dirty = draft.trim() !== (prompt ?? "").trim();
  const current = PERSONALITY_OPTIONS.find((o) => o.value === value) ?? PERSONALITY_OPTIONS[0];

  async function refine() {
    setFormError("");
    setBusy(true);
    try {
      const res = await fetch("/api/personality/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: draft }),
      });
      const body = await res.json();
      if (!res.ok) {
        setFormError(body.detail || "The model couldn't refine that — try again.");
        return;
      }
      setDraft(body.text);
    } catch {
      setFormError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <Select
        label="Personality"
        value={value}
        options={PERSONALITY_OPTIONS.map((o) => o.value)}
        labels={Object.fromEntries(PERSONALITY_OPTIONS.map((o) => [o.value, o.label]))}
        onChange={(personality) => onChange({ personality })}
      />
      <p className="-mt-1 text-[0.78rem] leading-snug text-zinc-500">{current.hint}</p>
      {value === "custom" && (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="A few words are enough — e.g. “dry British butler, unflappable, calls me sir”. Refine turns notes into a full brief; leave it empty to have the model invent one."
            aria-label="Custom personality"
            rows={5}
            maxLength={2000}
            disabled={busy}
            className={`${FIELD_CLS} resize-y leading-snug`}
          />
          {formError && <p className="text-[0.75rem] leading-snug text-red-400/90">{formError}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={refine} disabled={busy} className={BUTTON_CLS}>
              {busy ? "Asking the model…" : draft.trim() ? "Refine with model" : "Write one for me"}
            </button>
            <button
              type="button"
              onClick={() => onChange({ personalityPrompt: draft })}
              disabled={busy || !dirty}
              className={BUTTON_CLS}
            >
              Save personality
            </button>
            {dirty && !busy && <span className="text-[0.72rem] text-zinc-500">Unsaved changes</span>}
          </div>
        </>
      )}
    </div>
  );
}

// Read aloud in ten to fifteen seconds; varied sounds, natural rhythm.
const CLONE_PASSAGE =
  "Hi, this is my voice. I like it when the lights come on before I even ask, and when the coffee " +
  "is ready by the time I reach the kitchen. Some days I talk fast, some days I take my time, but " +
  "I always say exactly what I mean.";

function ClonedVoices({ active, selectedVoice, onUse }) {
  const [info, setInfo] = useState(null); // { engine, voices, default, clones }
  const [name, setName] = useState("");
  const [clip, setClip] = useState(null); // { blob, url }
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const { start, stop } = useRecorder((buffer) => {
    const blob = new Blob([buffer], { type: "audio/webm" });
    setClip((prev) => { if (prev) URL.revokeObjectURL(prev.url); return { blob, url: URL.createObjectURL(blob) }; });
  });

  const refresh = useCallback(() => {
    fetch("/api/voices").then((r) => r.json()).then(setInfo).catch(() => setFormError("Couldn't reach the speech engine."));
  }, []);
  useEffect(() => { if (active) { setFormError(""); refresh(); } }, [active, refresh]);

  async function toggleRecording() {
    setFormError("");
    if (recording) { stop(); setRecording(false); return; }
    try {
      await start();
      setRecording(true);
    } catch {
      setFormError("Couldn't open the microphone — allow access and try again.");
    }
  }

  async function call(url, init, okMessage) {
    setFormError("");
    setBusy(true);
    try {
      const res = await fetch(url, init);
      const body = await res.json();
      if (!res.ok) { setFormError(body.detail || okMessage); return null; }
      setInfo(body);
      return body;
    } catch {
      setFormError("Couldn't reach the server.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const form = new FormData();
    form.append("name", name.trim());
    form.append("file", clip.blob, "clip.webm");
    const body = await call("/api/voices", { method: "POST", body: form }, "Couldn't save the voice — try again.");
    if (!body) return;
    setName("");
    setClip((prev) => { if (prev) URL.revokeObjectURL(prev.url); return null; });
    if (chatterbox) onUse(body.voice);
  }

  async function remove(voice) {
    const body = await call(`/api/voices/${encodeURIComponent(voice)}`, { method: "DELETE" }, "Couldn't remove the voice.");
    if (body && voice === selectedVoice) onUse("default");
  }

  const chatterbox = String(info?.engine ?? "").startsWith("chatterbox-");
  const clones = info?.clones ?? [];
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <SectionTitle>Cloned voices</SectionTitle>
        {!chatterbox && info && (
          <p className="text-[0.78rem] leading-snug text-zinc-500">
            Cloned voices are spoken by Chatterbox. Switch to Chatterbox Turbo or Nano under Text-to-speech to use one; you can still record and delete them here.
          </p>
        )}
        {info && clones.length === 0 && (
          <p className="text-[0.78rem] leading-snug text-zinc-500">No cloned voices yet.</p>
        )}
        {clones.map((voice) => (
          <div key={voice} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5">
            <span className="flex min-w-0 items-center gap-2 text-[0.85rem] font-medium text-zinc-200">
              <span className="truncate">{voice}</span>
              {voice === selectedVoice && (
                <span className="rounded-full bg-aurora-teal/15 px-2 py-0.5 font-mono text-[0.55rem] uppercase tracking-wider text-aurora-teal">in use</span>
              )}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {chatterbox && voice !== selectedVoice && (
                <button type="button" onClick={() => onUse(voice)} disabled={busy} className={BUTTON_CLS}>Use</button>
              )}
              <button
                type="button"
                onClick={() => remove(voice)}
                disabled={busy}
                aria-label={`Delete voice ${voice}`}
                className="grid h-7 w-7 place-items-center rounded-full border border-white/10 text-zinc-500 transition-colors duration-300 hover:border-red-400/50 hover:text-red-300 disabled:opacity-50"
              >
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </span>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3">
        <span className="text-[0.85rem] font-medium text-zinc-200">Clone my voice</span>
        <p className="text-[0.78rem] leading-snug text-zinc-500">
          Read this aloud in your normal voice, ten to fifteen seconds, somewhere quiet. The voice picks up the mood you read it in.
        </p>
        <p className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[0.85rem] leading-relaxed text-zinc-300">
          {CLONE_PASSAGE}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={toggleRecording} disabled={busy} className={BUTTON_CLS} aria-pressed={recording}>
            {recording ? "Stop recording" : clip ? "Record again" : "Start recording"}
          </button>
          {recording && (
            <span className="flex items-center gap-1.5 text-[0.75rem] text-red-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" /> Recording
            </span>
          )}
          {clip && !recording && <audio controls src={clip.url} className="h-8 max-w-full" aria-label="Recording preview" />}
        </div>
        {clip && !recording && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name this voice (e.g. Ed)"
              aria-label="Voice name"
              maxLength={40}
              className={`${FIELD_CLS} w-auto flex-1`}
            />
            <button type="button" onClick={save} disabled={busy || !name.trim()} className={BUTTON_CLS}>
              {busy ? "Saving…" : "Save voice"}
            </button>
          </div>
        )}
      </div>
      {formError && <p className="text-[0.75rem] leading-snug text-red-400/90">{formError}</p>}
    </div>
  );
}

const TABS = [
  { key: "general", label: "General" },
  { key: "advanced", label: "Advanced" },
];

function Tabs({ value, onChange }) {
  return (
    <div role="tablist" aria-label="Settings sections" className="flex gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1">
      {TABS.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={`rounded-full px-3.5 py-1 text-[0.78rem] transition-colors duration-300 ${
            value === t.key ? "bg-white/[0.08] text-zinc-100" : "text-zinc-500 hover:text-zinc-200"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export default function SettingsPanel() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("general");
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
            <div className="flex items-center gap-3">
              <Tabs value={tab} onChange={setTab} />
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
            </div>
          </header>
          {error && (
            <p className="mx-6 mb-3 rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-[0.8rem] text-red-300 sm:mx-10">
              {error}
            </p>
          )}
          {tab === "advanced" && (
            <div className="settings-content modal-scroll overflow-y-auto" role="tabpanel" aria-label="Advanced">
              <section className="flex min-w-0 max-w-xl flex-col gap-5">
                <ClonedVoices
                  active={open && tab === "advanced"}
                  selectedVoice={data?.voice}
                  onUse={(voice) => update({ voice })}
                />
              </section>
            </div>
          )}
          {tab === "general" && (
          <div className="settings-content modal-scroll grid overflow-y-auto" role="tabpanel" aria-label="General">
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

                  <Personality
                    value={data.personality ?? "sassy"}
                    prompt={data.personalityPrompt ?? ""}
                    onChange={update}
                  />
                  <Toggle
                    label="Detailed drawings"
                    hint="Lets the model draw with filled shapes (circles, ellipses, rectangles, polygons, arcs) and more strokes. Off keeps simple outlines."
                    checked={!!data.detailedDrawings}
                    onChange={(detailedDrawings) => update({ detailedDrawings })}
                  />
                  <GeneralSection
                    data={data}
                    debugEnabled={debugEnabled}
                    toggleDebug={toggleDebug}
                    removeProvider={removeProvider}
                    onProvidersChanged={(body) => { mergeSettings(body); refreshProviders(body.providers ?? []); }}
                  />
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
          )}
        </div>
      </div>
    </>
  );
}
