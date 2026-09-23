import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { loadProviderModels } from "./chat/useModels";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { useSwipeNavigation } from "../hooks/useSwipeNavigation";
import { useVoiceStore } from "../store";
import ConnectionsSection from "./settings/ConnectionsSection";
import { OPEN_CONNECTIONS_EVENT } from "../lib/settingsNavigation";
import GeneralSection from "./settings/GeneralSection";
import AssistantSection from "./settings/AssistantSection";
import SpeechSection from "./settings/SpeechSection";
import SectionNav from "./settings/SectionNav";
import Toast from "./settings/Toast";

const SECTIONS = [
  { key: "connections", label: "Connections" },
  { key: "assistant", label: "Assistant" },
  { key: "speech", label: "Speech" },
  { key: "general", label: "General" },
];
const SECTION_ORDER = SECTIONS.map((section) => section.key);

export default function SettingsPanel() {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState("connections");
  const swipe = useSwipeNavigation(open, section, SECTION_ORDER, setSection, true);
  const [initialConnection, setInitialConnection] = useState<string | null>(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const panel = useRef(null);
  const content = useRef<HTMLDivElement>(null);
  const scrim = useRef(null);
  const debugEnabled = useVoiceStore((s) => s.debugEnabled);
  const toggleDebug = useVoiceStore((s) => s.toggleDebug);
  const trigger = useRef(null);
  const closeBtn = useRef(null);

  useLayoutEffect(() => {
    if (content.current) content.current.scrollTop = 0;
  }, [section]);

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

  useEffect(() => {
    const showConnections = (event: Event) => {
      setInitialConnection((event as CustomEvent).detail?.connection ?? null);
      setSection("connections");
      setOpen(true);
    };
    window.addEventListener(OPEN_CONNECTIONS_EVENT, showConnections);
    return () => window.removeEventListener(OPEN_CONNECTIONS_EVENT, showConnections);
  }, []);

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
        return false;
      }
      mergeSettings(body);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      return true;
    } catch {
      setError("Couldn't save — is the server running?");
      return false;
    }
  }

  return (
    <>
      <button
        ref={trigger}
        onClick={() => { setInitialConnection(null); setSection("connections"); setOpen(!open); }}
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
      <div className="settings-layer pointer-events-none fixed inset-0 z-50 grid place-items-center">
        <div
          ref={panel}
          {...swipe}
          inert={!open}
          role="dialog"
          aria-modal="true"
          aria-label="Settings"
          className="settings-panel pointer-events-auto invisible flex w-full flex-col overflow-hidden border border-white/10 bg-ink-900/95 opacity-0 shadow-2xl shadow-black/60 backdrop-blur-2xl"
        >
          <header className="settings-header flex items-center justify-between gap-3">
            <h2 className="text-xl font-medium text-zinc-100">Settings</h2>
            <button ref={closeBtn} onClick={() => setOpen(false)} aria-label="Close settings" className="icon-button">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </header>
          <div className="settings-body">
            <SectionNav sections={SECTIONS} value={section} onChange={setSection} />
            <div ref={content} className="settings-content modal-scroll" role="tabpanel" aria-labelledby={`settings-tab-${section}`}>
              <div className="settings-page">
                {section === "connections" && (
                  <ConnectionsSection key={`${open}-${initialConnection}`} data={data} update={update}
                    initialConnection={initialConnection} removeProvider={removeProvider}
                    onProvidersChanged={(body) => { mergeSettings(body); refreshProviders(body.providers ?? []); }} />
                )}
                {section === "general" && <GeneralSection debugEnabled={debugEnabled} toggleDebug={toggleDebug} />}
                {section === "assistant" && <AssistantSection data={data} update={update} />}
                {section === "speech" && (
                  <SpeechSection
                    data={data}
                    update={update}
                    active={open && section === "speech"}
                    onSwitched={() => { fetch("/api/settings").then((r) => r.json()).then(setData).catch(() => {}); }}
                  />
                )}
              </div>
              <Toast saved={saved} error={error} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
