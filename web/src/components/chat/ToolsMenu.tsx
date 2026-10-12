import ControlIcon from "../ControlIcon";
import { useEffect, useId, useRef, useState } from "react";
import { openHomeAssistantSettings } from "../../lib/settingsNavigation";
import { useChatStore } from "../../chatStore";
import { API_BASE } from "../../lib/config";
import { pollToolAvailability } from "../../lib/toolAvailability";

const TOOLS = [
  { key: "homeAssistant", label: "Allow home control" },
  { key: "webSearch", label: "Allow web search" },
  { key: "python", label: "Allow code execution" },
] as const;

export default function ToolsMenu() {
  const active = useChatStore((s) => s.active);
  const streaming = useChatStore((s) => s.streaming || s.backgroundResponding);
  const settingsSaving = useChatStore(s => s.settingsSaving || s.reconciling);
  const setTool = useChatStore((s) => s.setTool);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [haConfigured, setHaConfigured] = useState<boolean | null>(null);
  const [pythonReady, setPythonReady] = useState<boolean | null>(null);
  const [availabilityError, setAvailabilityError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const title = useId();
  const summaryId = useId();
  const allowed = Boolean(active && (active.homeAssistant || active.webSearch !== false || active.python !== false));
  const summary = `Home control ${active?.homeAssistant ? "allowed" : "off"}; web search ${active?.webSearch !== false ? "allowed" : "off"}; code execution ${active?.python !== false ? "allowed" : "off"}.`;

  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); trigger.current?.focus(); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setHaConfigured(null);
    setPythonReady(null);
    setAvailabilityError(false);
    return pollToolAvailability({
      url: `${API_BASE}/api/chat/tools`,
      update: body => { setHaConfigured(body.homeAssistant); setPythonReady(body.python); setAvailabilityError(false); },
      error: () => setAvailabilityError(true),
    });
  }, [open, retry]);

  const toggle = async (key: "homeAssistant" | "webSearch" | "python", enabled: boolean) => {
    if (key === "homeAssistant" && enabled && haConfigured !== true) return;
    setSaving(true);
    setError("");
    try { await setTool(key, enabled); }
    catch { setError("Couldn’t save this change. Please try again."); }
    finally { setSaving(false); }
  };

  return <>
    <button ref={trigger} type="button" aria-label="Chat tools" aria-describedby={summaryId} aria-haspopup="dialog" aria-expanded={open}
      data-enabled={allowed} title={summary}
      onClick={() => setOpen(true)}
      className="chat-tools-trigger grid h-11 w-11 shrink-0 place-items-center rounded-full text-zinc-500 transition-colors duration-300 hover:bg-white/[0.06] hover:text-zinc-200">
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <path d="M4 7h8m4 0h4M4 17h3m4 0h9" />
        <circle cx="14" cy="7" r="2" /><circle cx="9" cy="17" r="2" />
      </svg>
    </button>
    <span id={summaryId} className="sr-only">{summary}</span>
    {open && <dialog ref={dialog} className="model-sheet tools-sheet" aria-labelledby={title}
      onCancel={() => setOpen(false)} onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) setOpen(false);
      }}>
      <div className="model-sheet-heading">
        <h2 id={title}>Chat tools</h2>
        <button type="button" aria-label="Close tools" onClick={() => setOpen(false)}><ControlIcon name="close" /></button>
      </div>
      {TOOLS.map(({ key, label }) => {
        const unavailable = key === "homeAssistant" && haConfigured !== true;
        const enabled = key === "python" ? active?.python !== false : key === "webSearch" ? active?.webSearch !== false : Boolean(active?.homeAssistant);
        return <div key={key}><button type="button" role="switch" aria-checked={enabled}
          disabled={!active || saving || settingsSaving || streaming || (unavailable && !enabled)} aria-describedby={key === "python" ? `${title}-python` : unavailable ? `${title}-ha` : undefined} className="attachment-action flex items-center justify-between gap-4"
          onClick={() => void toggle(key, !enabled)}>
          <span>{label}</span>
          <span aria-hidden="true" className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${enabled ? "bg-[#8298bd]" : "bg-white/15"}`}>
            <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${enabled ? "translate-x-5" : "translate-x-1"}`} style={{ left: 0 }} />
          </span>
        </button>
          {key === "python" && <div id={`${title}-python`} className="tool-availability" role="status">
            <span className="tool-availability-label">{availabilityError ? "Status unknown" : pythonReady === null ? "Checking availability…" : pythonReady ? "Available" : "Unavailable"}</span>
            <p>{pythonReady === false ? "Your preference is saved. Code can run when the service is available." : "Analyse files and run code in an isolated sandbox."}</p>
          </div>}
          {unavailable && <div id={`${title}-ha`} className="mb-3 px-3 text-sm leading-relaxed text-zinc-400">
            {haConfigured === false ? <>
              <p>Add a server URL and access token to use your home devices in chat.</p>
              <button type="button" className="min-h-11 text-aurora-teal underline underline-offset-4"
                onClick={() => { setOpen(false); requestAnimationFrame(openHomeAssistantSettings); }}>Set up Home Assistant</button>
            </> : availabilityError ? <>
              <p>Couldn’t check the Home Assistant connection.</p>
            </> : <p role="status">Checking setup…</p>}
          </div>}
        </div>;
      })}
      {availabilityError && <button type="button" className="tool-status-retry" onClick={() => setRetry(value => value + 1)}>Retry availability check</button>}
      {streaming && <p role="status" className="text-sm text-zinc-400">Tools can be changed after the response finishes.</p>}
      {error && <p role="alert" className="text-sm text-zinc-400">{error}</p>}
    </dialog>}
  </>;
}
