import ControlIcon from "../ControlIcon";
import { deviceControls, useDeviceControlStore } from "../../deviceControlStore";
import { useEffect, useId, useRef, useState } from "react";
import { fractionOf, valueFromPointer } from "../../lib/touchSlider";

// Domain accents come from the shared aurora tokens so the cards sit at the
// same volume as the rest of the interface.
const ACCENTS: Record<string, string> = {
  light: "var(--color-aurora-ember)",
  switch: "var(--color-aurora-teal)",
  media_player: "var(--color-aurora-violet)",
  climate: "var(--color-aurora-ice)",
};

const COLOR_MODES = ["hs", "rgb", "rgbw", "rgbww", "xy"];

// Warm domestic tones first, saturated accents after.
const SWATCHES: [number, number, number][] = [
  [255, 180, 107], [255, 214, 170], [255, 244, 229], [255, 92, 64],
  [255, 170, 36], [64, 200, 120], [80, 140, 255], [168, 110, 255],
];

function nearestSwatch(rgb?: number[]) {
  if (!rgb) return -1;
  let best = -1, bestDist = Infinity;
  SWATCHES.forEach(([r, g, b], i) => {
    const d = (r - rgb[0]) ** 2 + (g - rgb[1]) ** 2 + (b - rgb[2]) ** 2;
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return bestDist < 60 ** 2 ? best : -1;
}

function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label}
      className="tswitch" data-on={on} onClick={onChange}>
      <span className="tswitch-track"><span className="tswitch-knob" /></span>
    </button>
  );
}

interface BarProps {
  label: string; value: number; min: number; max: number; step: number;
  format: (value: number) => string; onCommit: (value: number) => void;
  ariaLabel: string; track?: string; showValue?: "always" | "drag";
}

// A drag-anywhere bar: the whole 48px-tall surface is the control, so a thumb
// on a phone never has to find a tiny handle.
function TouchBar({ label, value, min, max, step, format, onCommit, ariaLabel, track, showValue = "always" }: BarProps) {
  const bar = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState(value);
  const [active, setActive] = useState(false);
  const dragging = useRef(false);
  useEffect(() => { if (!dragging.current) setLive(value); }, [value]);

  const read = (clientX: number) => {
    const rect = bar.current?.getBoundingClientRect();
    return rect ? valueFromPointer(clientX, rect, min, max, step) : live;
  };
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    setActive(true);
    bar.current?.setPointerCapture(e.pointerId);
    setLive(read(e.clientX));
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragging.current) setLive(read(e.clientX));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    setActive(false);
    const next = read(e.clientX);
    setLive(next);
    if (next !== value) onCommit(next);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const delta = e.key === "ArrowRight" || e.key === "ArrowUp" ? step
      : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -step : 0;
    if (!delta) return;
    e.preventDefault();
    const next = Math.max(min, Math.min(max, live + delta));
    setLive(next);
    onCommit(next);
  };
  const fraction = fractionOf(live, min, max);
  return (
    <div ref={bar} className="tbar" role="slider" tabIndex={0} aria-label={ariaLabel}
      data-active={active} data-track={Boolean(track)}
      aria-valuemin={min} aria-valuemax={max} aria-valuenow={live} aria-valuetext={format(live)}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove}
      onPointerUp={onPointerUp} onPointerCancel={() => { dragging.current = false; setActive(false); setLive(value); }} onKeyDown={onKeyDown}>
      {track && <div className="tbar-track" style={{ background: track }} />}
      <div className="tbar-fill" style={{ width: `${fraction * 100}%` }} />
      <span className="tbar-label">{label}</span>
      <span className="tbar-value" data-visible={showValue === "always" || active}>{format(live)}</span>
    </div>
  );
}

function ColorChips({ card, sendControl }) {
  const active = nearestSwatch(card.attrs.rgb_color);
  return (
    <div className="chips" role="group" aria-label={`${card.name} color`}>
      {SWATCHES.map(([r, g, b], i) => (
        <button type="button" key={i} className="chip" data-active={active === i}
          aria-label={`Set ${card.name} color to rgb(${r}, ${g}, ${b})`}
          aria-pressed={active === i}
          style={{ background: `rgb(${r}, ${g}, ${b})` }}
          onClick={() => sendControl({
            type: "control", domain: "light", service: "turn_on",
            entity_id: card.entity_id, data: { rgb_color: [r, g, b] },
          })} />
      ))}
    </div>
  );
}

function LightControls({ card, sendControl }) {
  const pct = card.attrs.brightness != null ? Math.max(1, Math.round((card.attrs.brightness / 255) * 100)) : 100;
  const modes: string[] = card.attrs.supported_color_modes || [];
  const hasTemp = modes.includes("color_temp");
  const hasColor = modes.some((m) => COLOR_MODES.includes(m));
  const minK = card.attrs.min_color_temp_kelvin ?? 2000;
  const maxK = card.attrs.max_color_temp_kelvin ?? 6500;
  const turnOn = (data: Record<string, unknown>) => sendControl({
    type: "control", domain: "light", service: "turn_on", entity_id: card.entity_id, data,
  });
  return (
    <>
      <TouchBar label="Brightness" value={pct} min={1} max={100} step={1}
        format={(v) => `${v}%`} ariaLabel={`${card.name} brightness`} showValue="drag"
        onCommit={(v) => turnOn({ brightness_pct: v })} />
      {hasTemp && (
        <TouchBar label="Warmth" value={card.attrs.color_temp_kelvin ?? Math.round((minK + maxK) / 2)}
          min={minK} max={maxK} step={50} format={(v) => `${v} K`}
          ariaLabel={`${card.name} color temperature`}
          track="linear-gradient(to right, #e6b58a, #f3e9dc 55%, #b0cddd)"
          onCommit={(v) => turnOn({ color_temp_kelvin: v })} />
      )}
      {hasColor && <ColorChips card={card} sendControl={sendControl} />}
    </>
  );
}

function ClimateControls({ card, sendControl }) {
  const target = card.attrs.temperature;
  if (target == null) return null;
  const step = (delta: number) => sendControl({
    type: "control", domain: "climate", service: "set_temperature",
    entity_id: card.entity_id, data: { temperature: Math.round((target + delta) * 2) / 2 },
  });
  return (
    <div className="stepper" role="group" aria-label={`${card.name} target temperature`}>
      <button type="button" className="stepper-button" aria-label="Lower target" onClick={() => step(-0.5)}><ControlIcon name="minus" /></button>
      <span className="stepper-value"><span className="stepper-caption">Target</span>{target}°</span>
      <button type="button" className="stepper-button" aria-label="Raise target" onClick={() => step(0.5)}><ControlIcon name="plus" /></button>
    </div>
  );
}

function reading(card) {
  const on = card.state === "on";
  switch (card.domain) {
    case "light":
      if (!on) return { value: "Off" };
      return { value: card.attrs.brightness != null ? Math.max(1, Math.round((card.attrs.brightness / 255) * 100)) : 100, unit: "%" };
    case "switch":
    case "media_player":
      return { value: on ? "On" : card.state === "off" ? "Off" : card.state };
    case "climate":
      return { value: card.attrs.current_temperature ?? "–", unit: "°" };
    default:
      return { value: card.state, unit: card.attrs.unit_of_measurement || "" };
  }
}

function DeviceIcon({ domain }) {
  return <svg className="ecard-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {domain === 'light' ? <><path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 2H9s0-1-1-2Z"/></>
      : domain === 'climate' ? <><path d="M9 14V5a3 3 0 0 1 6 0v9a5 5 0 1 1-6 0Z M12 8v9"/><circle cx="12" cy="17" r="1"/></>
      : domain === 'sensor' || domain === 'binary_sensor' ? <><path d="M4 18a9 9 0 1 1 16 0Z M12 14l4-5"/><circle cx="12" cy="14" r="1"/></>
      : domain === 'media_player' ? <><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4m-2-13 5 3-5 3Z"/></>
      : <><circle cx="12" cy="12" r="8"/><path d="M12 3v8"/></>}
  </svg>;
}

export default function EntityCard({ card: sourceCard, sendControl: transport, compact = false }) {
  const control = useDeviceControlStore(s => s.devices[sourceCard.entity_id]);
  const card = control?.card ?? sourceCard;
  const sendControl = (message) => deviceControls.send(card, message, transport);
  const [expanded, setExpanded] = useState(false);
  const controlsId = useId();
  const toggleable = ["light", "switch", "media_player"].includes(card.domain);
  const on = card.state === "on";
  const accent = ACCENTS[card.domain] ?? "var(--color-zinc-500)";
  const { value, unit } = reading(card);
  const hasControls = (card.domain === "light" && on) || (card.domain === "climate" && card.attrs.temperature != null);
  const title = <><DeviceIcon domain={card.domain}/><span className="ecard-title">
    <span className="ecard-name" title={card.name}>{card.name}</span>
    <span className="ecard-eyebrow" role="status">{control?.pending ? "Updating…" : card.area || card.domain.replace(/_/g, " ")}</span>
  </span></>;
  const readingElement = <span className="ecard-reading">{value}{unit && <span className="ecard-unit">{unit}</span>}</span>;
  return (
    <div className="entity-card ecard" data-compact={compact || undefined} data-on={toggleable ? on : undefined}
      style={{ "--card-accent": accent } as React.CSSProperties}>
      <div className="ecard-head">
        {compact && hasControls ? <button type="button" className="ecard-summary" aria-expanded={expanded} aria-controls={controlsId}
          aria-label={`${expanded ? 'Hide' : 'Show'} ${card.name} controls`} onClick={() => setExpanded(!expanded)}>
          {title}{readingElement}<span className="ecard-chevron" aria-hidden="true"><ControlIcon name={expanded ? "minus" : "plus"} size={16} /></span>
        </button> : <div className="ecard-summary">{title}{compact && readingElement}</div>}
        {toggleable && <Switch on={on} label={`Turn ${on ? "off" : "on"} ${card.name}`}
          onChange={() => sendControl({ type: "control", domain: card.domain, service: on ? "turn_off" : "turn_on", entity_id: card.entity_id })}/>}
      </div>
      {control?.error && <p className="ecard-error" role="alert">{control.error}</p>}
      {!compact && readingElement}
      {hasControls && <div id={controlsId} className="ecard-controls" hidden={compact && !expanded}>
        {card.domain === "light" && on && <LightControls card={card} sendControl={sendControl} />}
        {card.domain === "climate" && <ClimateControls card={card} sendControl={sendControl} />}
      </div>}
    </div>
  );
}
