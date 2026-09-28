import { useEffect, useRef, useState } from "react";
import type { ReadingState } from "../../lib/messageReader";

function Icon({ kind }: { kind: "copy" | "check" | "speaker" | "stop" | "retry" }) {
  return <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "copy" && <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>}
    {kind === "check" && <path d="m5 12 4 4L19 6" />}
    {kind === "speaker" && <><path d="m11 4-6 5H2v6h3l6 5z" /><path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" /></>}
    {kind === "stop" && <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />}
    {kind === "retry" && <><path d="M20 7v5h-5" /><path d="M20 12a8 8 0 1 0-2.4 5.7M20 7v5" /></>}
  </svg>;
}

export default function MessageActions({ text, getSpokenText, reading, onRead, onRegenerate, disabled }: {
  text: string;
  getSpokenText: () => string;
  reading: ReadingState;
  onRead: (text: string) => void;
  onRegenerate: () => void;
  disabled: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => { setCopied(false); setError(""); return () => clearTimeout(timer.current); }, [text]);
  const active = reading && reading.phase !== "error";
  const copy = async () => {
    setError("");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard is unavailable in this browser.");
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch { setError("Could not copy. Select the message text to copy it."); }
  };
  return <div className="message-action-group">
    <div className="message-actions" role="group" aria-label="Message actions">
      <button type="button" aria-label={copied ? "Copied" : "Copy message"} title={copied ? "Copied" : "Copy"}
        disabled={!text.trim()} onClick={() => void copy()} data-active={copied}><Icon kind={copied ? "check" : "copy"} /></button>
      <button type="button" aria-label={active ? "Stop reading" : "Read aloud"} title={active ? "Stop reading" : "Read aloud"}
        aria-pressed={Boolean(active)} disabled={!text.trim() || disabled} onClick={() => onRead(getSpokenText())} data-active={Boolean(active)}>
        {reading?.phase === "loading" ? <span className="message-audio-loading" aria-hidden="true" /> : <Icon kind={active ? "stop" : "speaker"} />}
      </button>
      <button type="button" aria-label="Regenerate answer" title="Regenerate answer" disabled={disabled} onClick={onRegenerate}><Icon kind="retry" /></button>
    </div>
    {(error || reading?.error) && <p role="alert" className="message-action-error">{error || reading?.error}</p>}
  </div>;
}
