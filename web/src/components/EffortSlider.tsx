import { useEffect, useId, useRef, useState, type CSSProperties } from "react";

import { createHapticTick } from "../lib/haptics";

const label = (value: string | null) => value === null ? "Default" : value === "xhigh" ? "Extra high" : value[0].toUpperCase() + value.slice(1);

export default function EffortSlider({ levels, value, model, onChange, disabled = false }: {
  levels: string[];
  value: string | null;
  model: string;
  onChange: (value: string | null) => Promise<void> | void;
  disabled?: boolean;
}) {
  const id = useId();
  const defaultValue = levels.includes("medium") ? "medium" : null;
  const steps = defaultValue ? levels : [null, ...levels];
  const [draft, setDraft] = useState(value ?? defaultValue);
  const [pressed, setPressed] = useState(false);
  const tick = useRef(createHapticTick());
  const draftRef = useRef(draft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  useEffect(() => { draftRef.current = value ?? defaultValue; setDraft(value ?? defaultValue); }, [value, defaultValue]);
  const position = Math.max(0, steps.indexOf(draft));
  const commit = async (index: number) => {
    const next = steps[index];
    if (disabled || busy.current || next === value) return;
    busy.current = true;
    setSaving(true);
    setError("");
    try { await onChange(next); }
    catch (e) { draftRef.current = value ?? defaultValue; setDraft(value ?? defaultValue); setError(e instanceof Error ? e.message : "Could not save effort. Try again."); }
    finally { busy.current = false; setSaving(false); }
  };
  return (
    <section className="mpick-effort" aria-busy={saving}>
      <div className="mpick-effort-heading">
        <div className="mpick-effort-label"><label htmlFor={id}>Effort</label><span title={model}>{model}</span></div>
        <output htmlFor={id}>{label(draft)}</output>
      </div>
      <div className="effort-control" data-pressed={pressed} data-disabled={disabled || saving}
        style={{ "--effort-progress": `${position / Math.max(1, steps.length - 1) * 100}%` } as CSSProperties}>
      <div className="effort-rail" aria-hidden="true">
        <div className="effort-fill" />
        {steps.map((step, i) => <span key={step ?? "default"} className="effort-stop"
          data-filled={i <= position} style={{ left: `${i / Math.max(1, steps.length - 1) * 100}%` }} />)}
        <span className="effort-thumb" />
      </div>
      <input id={id} type="range" min={0} max={steps.length - 1} step={1}
        value={position} aria-disabled={disabled || saving} aria-valuetext={label(draft)}
        onChange={e => {
          if (disabled || saving) return;
          const next = steps[Number(e.currentTarget.value)];
          if (next !== draftRef.current) { tick.current(); draftRef.current = next; setDraft(next); }
        }}
        onPointerDown={e => {
          if (disabled || saving) { e.preventDefault(); return; }
          e.currentTarget.setPointerCapture(e.pointerId);
          setPressed(true);
        }}
        onPointerCancel={() => { setPressed(false); draftRef.current = value ?? defaultValue; setDraft(value ?? defaultValue); }}
        onLostPointerCapture={() => setPressed(false)}
        onKeyDown={e => { if ((disabled || saving) && /^(Arrow|Home|End|Page)/.test(e.key)) e.preventDefault(); }}
        onPointerUp={e => { setPressed(false); void commit(Number(e.currentTarget.value)); }}
        onKeyUp={e => void commit(Number(e.currentTarget.value))}
        onBlur={e => { setPressed(false); void commit(Number(e.currentTarget.value)); }} />
      </div>
      <div className="mpick-effort-ends" aria-hidden="true"><span>{label(steps[0])}</span><span>{label(steps[steps.length - 1])}</span></div>
      {error && <p role="alert" className="mpick-error">{error}</p>}
    </section>
  );
}
