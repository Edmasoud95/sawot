import { useEffect, useRef, useState } from "react";
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
      onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onKeyDown={onKeyDown}>
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
      <button type="button" className="stepper-button" aria-label="Lower target" onClick={() => step(-0.5)}>−</button>
      <span className="stepper-value"><span className="stepper-caption">Target</span>{target}°</span>
      <button type="button" className="stepper-button" aria-label="Raise target" onClick={() => step(0.5)}>+</button>
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

export default function EntityCard({ card, sendControl }) {
  const toggleable = ["light", "switch", "media_player"].includes(card.domain);
  const on = card.state === "on";
  const accent = ACCENTS[card.domain] ?? "var(--color-zinc-500)";
  const { value, unit } = reading(card);
  return (
    <div className="entity-card ecard" data-on={toggleable ? on : undefined}
      style={{ "--card-accent": accent } as React.CSSProperties}>
      <div className="ecard-head">
        <div className="ecard-title">
          <p className="ecard-name">{card.name}</p>
          <p className="ecard-eyebrow">{card.area || card.domain.replace("_", " ")}</p>
        </div>
        {toggleable && (
          <Switch on={on} label={`Turn ${on ? "off" : "on"} ${card.name}`}
            onChange={() => sendControl({
              type: "control", domain: card.domain,
              service: on ? "turn_off" : "turn_on", entity_id: card.entity_id,
            })} />
        )}
      </div>
      <p className="ecard-reading">
        {value}
        {unit && <span className="ecard-unit">{unit}</span>}
      </p>
      {card.domain === "light" && on && <LightControls card={card} sendControl={sendControl} />}
      {card.domain === "climate" && <ClimateControls card={card} sendControl={sendControl} />}
    </div>
  );
}
