import { useEffect, useRef, useState } from "react";
import { DictationController, type DictationState } from "../../lib/dictation";
import { BrowserDictationRecorder } from "../../lib/dictationRecorder";
import { transcribeDictation } from "../../lib/dictationApi";
import "./dictation.css";

const Mic = () => <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" /></svg>;
const Stop = () => <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="2" /></svg>;

const Waveform = () => <div className="dictation-wave" aria-hidden="true">{[.4, .75, 1, .6, .9, .5, .8, .6, 1, .45, .7, .9, .5, .8, .4].map((weight, index) => <i key={index} style={{ "--bar-weight": weight } as React.CSSProperties} />)}</div>;

export default function DictationButton({ disabled, onText, onBusy }: {
  disabled: boolean; onText(text: string): void; onBusy(busy: boolean): void;
}) {
  const [state, setState] = useState<DictationState>({ mode: "idle", ready: false, error: "" });
  const root = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onText, onBusy });
  callbacks.current = { onText, onBusy };
  const [controller] = useState(() => {
    const recorder = new BrowserDictationRecorder(
      level => root.current?.style.setProperty("--dictation-level", String(level)),
      () => control.cancel("Microphone recording stopped. Please try again."),
    );
    const control = new DictationController({ recorder, transcribe: transcribeDictation,
      onText: text => callbacks.current.onText(text), onChange: setState });
    return control;
  });
  const busy = state.mode !== "idle";
  const expanded = state.mode === "latched" || state.mode === "transcribing";

  useEffect(() => { callbacks.current.onBusy(busy); }, [busy]);
  useEffect(() => {
    const cancel = () => controller.cancel();
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && controller.state.mode !== "idle") { event.preventDefault(); event.stopPropagation(); cancel(); } };
    const hidden = () => { if (document.hidden) cancel(); };
    window.addEventListener("keydown", escape, true);
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", hidden);
      controller.cancel();
      callbacks.current.onBusy(false);
    };
  }, [controller]);
  useEffect(() => { if (disabled) controller.cancel(); }, [disabled, controller]);

  const label = state.mode === "transcribing" ? "Transcribing…"
    : !state.ready && busy ? "Opening microphone…"
    : "Listening…";

  return <div ref={root} className="dictation" data-mode={state.mode}>
    {expanded && <div className="dictation-panel">
      <Waveform />
      <span role="status" className="dictation-label">{label}</span>
      <button type="button" className="dictation-action" onClick={() => controller.cancel()} aria-label="Cancel dictation">×</button>
    </div>}
    {state.error && <div className="dictation-error" role="alert">{state.error}<button type="button" onClick={() => controller.cancel()} aria-label="Dismiss dictation error">×</button></div>}
    <button type="button" className="dictation-mic" disabled={disabled || state.mode === "transcribing"}
      aria-label={state.mode === "latched" ? "Finish dictation" : busy ? "Stop dictation" : "Dictate message"} aria-pressed={busy}
      title={busy ? "Stop dictation" : "Start dictation"}
      onClick={() => controller.toggle()}
    >{state.mode === "latched" ? <Stop /> : <Mic />}</button>
  </div>;
}
