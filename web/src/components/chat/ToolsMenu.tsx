import { useEffect, useId, useRef, useState } from "react";
import { openHomeAssistantSettings } from "../../lib/settingsNavigation";
import { useChatStore } from "../../chatStore";

const TOOLS = [
  { key: "homeAssistant", label: "Home Assistant" },
  { key: "webSearch", label: "Web search" },
] as const;

export default function ToolsMenu() {
  const active = useChatStore((s) => s.active);
  const streaming = useChatStore((s) => s.streaming);
  const setTool = useChatStore((s) => s.setTool);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [haConfigured, setHaConfigured] = useState<boolean | null>(null);
  const [availabilityError, setAvailabilityError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const title = useId();

  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); trigger.current?.focus(); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setHaConfigured(null);
    setAvailabilityError(false);
    fetch("/api/chat/tools", { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error();
        const body = await response.json();
        if (typeof body.homeAssistant !== "boolean") throw new Error();
        if (!controller.signal.aborted) setHaConfigured(body.homeAssistant);
      })
      .catch(() => { if (!controller.signal.aborted) setAvailabilityError(true); });
    return () => controller.abort();
  }, [open, retry]);

  const toggle = async (key: "homeAssistant" | "webSearch", enabled: boolean) => {
    if (key === "homeAssistant" && haConfigured !== true) return;
    setSaving(true);
    setError("");
    try { await setTool(key, enabled); }
    catch { setError("Couldn’t save this change. Please try again."); }
    finally { setSaving(false); }
  };

  return <>
    <button ref={trigger} type="button" aria-label="Chat tools" aria-haspopup="dialog" aria-expanded={open}
      onClick={() => setOpen(true)}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-zinc-500 transition-colors duration-300 hover:bg-white/[0.06] hover:text-zinc-200">
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <path d="M4 7h8m4 0h4M4 17h3m4 0h9" />
        <circle cx="14" cy="7" r="2" /><circle cx="9" cy="17" r="2" />
      </svg>
    </button>
    {open && <dialog ref={dialog} className="model-sheet tools-sheet" aria-labelledby={title}
      onCancel={() => setOpen(false)} onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) setOpen(false);
      }}>
      <div className="model-sheet-heading">
        <h2 id={title}>Chat tools</h2>
        <button type="button" aria-label="Close tools" onClick={() => setOpen(false)}><span className="ui-text-icon" aria-hidden="true">×</span></button>
      </div>
      {TOOLS.map(({ key, label }) => {
        const unavailable = key === "homeAssistant" && haConfigured !== true;
        const enabled = key === "webSearch" ? active?.webSearch !== false : !unavailable && Boolean(active?.homeAssistant);
        return <div key={key}><button type="button" role="switch" aria-checked={enabled}
          disabled={!active || saving || streaming || unavailable} aria-describedby={unavailable ? "ha-setup-status" : undefined} className="attachment-action flex items-center justify-between gap-4"
          onClick={() => void toggle(key, !enabled)}>
          <span>{label}</span>
          <span aria-hidden="true" className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${enabled ? "bg-[#8298bd]" : "bg-white/15"}`}>
            <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${enabled ? "translate-x-5" : "translate-x-1"}`} style={{ left: 0 }} />
          </span>
        </button>
          {unavailable && <div id="ha-setup-status" className="mb-3 px-3 text-sm leading-relaxed text-zinc-400">
            {haConfigured === false ? <>
              <p>Add a server URL and access token to use your home devices in chat.</p>
              <button type="button" className="min-h-11 text-aurora-teal underline underline-offset-4"
                onClick={() => { setOpen(false); requestAnimationFrame(openHomeAssistantSettings); }}>Set up Home Assistant</button>
            </> : availabilityError ? <>
              <p>Couldn’t check the Home Assistant connection.</p>
              <button type="button" className="min-h-11 text-aurora-teal" onClick={() => setRetry(value => value + 1)}>Retry</button>
            </> : <p role="status">Checking setup…</p>}
          </div>}
        </div>;
      })}
      {streaming && <p role="status" className="text-sm text-zinc-400">Tools can be changed after the response finishes.</p>}
      {error && <p role="alert" className="text-sm text-zinc-400">{error}</p>}
    </dialog>}
  </>;
}
