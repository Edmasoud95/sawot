// Domain → aurora accent. Full class strings (not interpolated) so Tailwind
// can see them at build time; the glow rides the same token via box-shadow.
const ACCENTS = {
  light: {
    label: "text-aurora-ember/70",
    toggleOn: "border-aurora-ember/60 bg-aurora-ember/25",
    slider: "accent-[#ff9d6b]",
    glow: "0 0 44px -14px rgba(255, 157, 107, 0.55)",
    edge: "rgba(255, 157, 107, 0.35)",
  },
  switch: {
    label: "text-aurora-teal/70",
    toggleOn: "border-aurora-teal/60 bg-aurora-teal/25",
    glow: "0 0 44px -14px rgba(62, 230, 196, 0.5)",
    edge: "rgba(62, 230, 196, 0.35)",
  },
  media_player: {
    label: "text-aurora-violet/70",
    toggleOn: "border-aurora-violet/60 bg-aurora-violet/25",
    glow: "0 0 44px -14px rgba(182, 156, 255, 0.5)",
    edge: "rgba(182, 156, 255, 0.35)",
  },
  climate: {
    label: "text-aurora-ice/70",
    glow: "0 0 44px -14px rgba(154, 212, 255, 0.4)",
    edge: "rgba(154, 212, 255, 0.3)",
  },
};
const FALLBACK = { label: "text-zinc-500" };

const UNIT = (card) => card.attrs.unit_of_measurement || "";

function Toggle({ card, accent, sendControl }) {
  const on = card.state === "on";
  return (
    <button
      onClick={() =>
        sendControl({
          type: "control",
          domain: card.domain,
          service: on ? "turn_off" : "turn_on",
          entity_id: card.entity_id,
        })
      }
      aria-label={`Turn ${on ? "off" : "on"} ${card.name}`}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-300 ${
        on ? accent.toggleOn : "border-white/15 bg-white/5"
      }`}
    >
      <span
        className={`absolute top-0.5 h-4.5 w-4.5 rounded-full transition-all duration-300 ${
          on ? "left-[calc(100%-20px)] bg-zinc-100" : "left-0.5 bg-zinc-400"
        }`}
      />
    </button>
  );
}

function Brightness({ card, accent, sendControl }) {
  const pct =
    card.attrs.brightness != null
      ? Math.max(1, Math.round((card.attrs.brightness / 255) * 100))
      : 0;
  return (
    <input
      type="range"
      min="1"
      max="100"
      defaultValue={pct}
      aria-label={`${card.name} brightness`}
      onPointerUp={(e) =>
        sendControl({
          type: "control",
          domain: "light",
          service: "turn_on",
          entity_id: card.entity_id,
          data: { brightness_pct: Number((e.target as HTMLInputElement).value) },
        })
      }
      className={`h-1 w-full cursor-pointer appearance-auto ${accent.slider}`}
    />
  );
}

// Curated palette: warm domestic tones first, saturated accents after.
const SWATCHES = [
  [255, 180, 107], // candle
  [255, 214, 170], // warm white
  [255, 244, 229], // soft white
  [255, 92, 64],   // ember red
  [255, 170, 36],  // amber
  [64, 200, 120],  // sage green
  [80, 140, 255],  // azure
  [168, 110, 255], // violet
];

const COLOR_MODES = ["hs", "rgb", "rgbw", "rgbww", "xy"];

function nearestSwatch(rgb) {
  if (!rgb) return -1;
  let best = -1;
  let bestDist = Infinity;
  SWATCHES.forEach(([r, g, b], i) => {
    const d = (r - rgb[0]) ** 2 + (g - rgb[1]) ** 2 + (b - rgb[2]) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return bestDist < 60 ** 2 ? best : -1;
}

function ColorControls({ card, sendControl }) {
  const modes = card.attrs.supported_color_modes || [];
  const hasTemp = modes.includes("color_temp");
  const hasColor = modes.some((m) => COLOR_MODES.includes(m));
  if (!hasTemp && !hasColor) return null;

  const minK = card.attrs.min_color_temp_kelvin ?? 2000;
  const maxK = card.attrs.max_color_temp_kelvin ?? 6500;
  const activeSwatch = nearestSwatch(card.attrs.rgb_color);

  return (
    <div className="flex flex-col gap-2.5">
      {hasTemp && (
        <input
          type="range"
          min={minK}
          max={maxK}
          step="50"
          defaultValue={card.attrs.color_temp_kelvin ?? (minK + maxK) / 2}
          aria-label={`${card.name} color temperature`}
          onPointerUp={(e) =>
            sendControl({
              type: "control",
              domain: "light",
              service: "turn_on",
              entity_id: card.entity_id,
              data: { color_temp_kelvin: Number((e.target as HTMLInputElement).value) },
            })
          }
          className="temp-slider h-1.5 w-full cursor-pointer appearance-none rounded-full"
          style={{
            background:
              "linear-gradient(to right, #ffb46b, #fff4e5 45%, #cfe4ff)",
          }}
        />
      )}
      {hasColor && (
        <div className="flex items-center gap-2">
          {SWATCHES.map(([r, g, b], i) => (
            <button
              key={i}
              aria-label={`Set ${card.name} color to rgb(${r}, ${g}, ${b})`}
              onClick={() =>
                sendControl({
                  type: "control",
                  domain: "light",
                  service: "turn_on",
                  entity_id: card.entity_id,
                  data: { rgb_color: [r, g, b] },
                })
              }
              className={`h-5 w-5 shrink-0 rounded-full transition-transform duration-200 hover:scale-110 ${
                activeSwatch === i
                  ? "ring-2 ring-white/70 ring-offset-2 ring-offset-ink-900"
                  : "ring-1 ring-white/15"
              }`}
              style={{ backgroundColor: `rgb(${r}, ${g}, ${b})` }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ClimateControl({ card, sendControl }) {
  const target = card.attrs.temperature;
  const step = (delta) =>
    sendControl({
      type: "control",
      domain: "climate",
      service: "set_temperature",
      entity_id: card.entity_id,
      data: { temperature: Math.round((target + delta) * 2) / 2 },
    });
  return (
    <div className="flex items-end justify-between">
      <span className="font-serif text-3xl font-light leading-none text-zinc-100">
        {card.attrs.current_temperature ?? "–"}
        <span className="text-lg text-zinc-500">°</span>
      </span>
      {target != null && (
        <span className="flex items-center gap-2 font-mono text-[0.75rem] text-aurora-ice/80">
          <button
            onClick={() => step(-0.5)}
            aria-label="Lower target"
            className="grid h-7 w-7 place-items-center rounded-full border border-white/15 text-zinc-400 transition-colors duration-300 hover:border-aurora-ice/50 hover:text-aurora-ice"
          >
            −
          </button>
          {target}°
          <button
            onClick={() => step(0.5)}
            aria-label="Raise target"
            className="grid h-7 w-7 place-items-center rounded-full border border-white/15 text-zinc-400 transition-colors duration-300 hover:border-aurora-ice/50 hover:text-aurora-ice"
          >
            +
          </button>
        </span>
      )}
    </div>
  );
}

export default function EntityCard({ card, sendControl }) {
  const toggleable = ["light", "switch", "media_player"].includes(card.domain);
  const accent = ACCENTS[card.domain] || FALLBACK;
  const lit = toggleable && card.state === "on";
  return (
    <div
      className="entity-card flex flex-col gap-3 rounded-2xl border bg-ink-900/70 p-4 backdrop-blur-md transition-[border-color,box-shadow] duration-500"
      style={{
        borderColor: lit ? accent.edge : "rgba(255,255,255,0.10)",
        boxShadow: lit ? accent.glow : "none",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[0.95rem] text-zinc-100">{card.name}</p>
          <p
            className={`font-mono text-[0.6rem] uppercase tracking-[0.2em] ${accent.label}`}
          >
            {card.area || card.domain}
          </p>
        </div>
        {toggleable && (
          <Toggle card={card} accent={accent} sendControl={sendControl} />
        )}
      </div>
      {card.domain === "light" && card.state === "on" && (
        <>
          <Brightness card={card} accent={accent} sendControl={sendControl} />
          <ColorControls card={card} sendControl={sendControl} />
        </>
      )}
      {card.domain === "climate" && (
        <ClimateControl card={card} sendControl={sendControl} />
      )}
      {!toggleable && card.domain !== "climate" && (
        <p className="font-serif text-2xl font-light leading-none text-zinc-100">
          {card.state}{" "}
          <span className="font-mono text-[0.7rem] tracking-[0.12em] text-zinc-500">
            {UNIT(card)}
          </span>
        </p>
      )}
    </div>
  );
}
