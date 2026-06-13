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
          data: { brightness_pct: Number(e.target.value) },
        })
      }
      className={`h-1 w-full cursor-pointer appearance-auto ${accent.slider}`}
    />
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
        <Brightness card={card} accent={accent} sendControl={sendControl} />
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
