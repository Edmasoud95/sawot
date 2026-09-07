import { useEffect, useMemo, useState } from "react";
import { useVoiceStore } from "../store";
import { useChatStore } from "../chatStore";
import { useDebugStore, type DebugTurn } from "../debugStore";

const TABS = ["timeline", "events", "messages", "state"] as const;
type Tab = (typeof TABS)[number];

const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${Math.round(n)} ms`);
const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour12: false });

function Json({ value }: { value: unknown }) {
  const text = useMemo(() => {
    try { return typeof value === "string" ? value : JSON.stringify(value, null, 2); } catch { return String(value); }
  }, [value]);
  return <pre className="dbg-json">{text}</pre>;
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "bad" }) {
  return (
    <span className="dbg-tile" data-tone={tone}>
      <span className="dbg-tile-label">{label}</span>
      <span className="dbg-tile-value">{value}</span>
    </span>
  );
}

function Timeline({ turn }: { turn: DebugTurn }) {
  const stages = [
    ["stt", "Speech to text", turn.stages.stt],
    ["llm", "Model", turn.stages.llm],
    ["tools", "Tools", turn.stages.tools],
    ["tts", "Text to speech", turn.stages.tts],
  ] as const;
  return (
    <div className="dbg-timeline">
      <div className="dbg-bar" role="img" aria-label="Turn timeline">
        {stages.map(([key, , value]) => value > 0 && (
          <span key={key} className="dbg-bar-seg" data-stage={key} style={{ flexGrow: value }} title={`${key} ${ms(value)}`} />
        ))}
      </div>
      <ul className="dbg-stages">
        {stages.map(([key, label, value]) => (
          <li key={key}><span className="dbg-swatch" data-stage={key} />{label}<b>{value ? ms(value) : "–"}</b></li>
        ))}
        <li>Total<b>{ms(turn.total)}</b></li>
        <li>Model rounds<b>{turn.events.filter((e) => e.event === "llm_round").length}</b></li>
        <li>Tool calls<b>{turn.toolCalls}</b></li>
      </ul>
      {turn.text && <p className="dbg-reply">{turn.text}</p>}
      {turn.expression !== undefined && (
        <details className="dbg-details"><summary>Orb expression</summary><Json value={turn.expression} /></details>
      )}
    </div>
  );
}

function Events({ turn }: { turn: DebugTurn }) {
  return (
    <ol className="dbg-events">
      {turn.events.map((e, i) => (
        <li key={i}>
          <details className="dbg-details">
            <summary>
              <span className="dbg-time">{clock(e.at)}</span>
              <span className="dbg-event" data-event={e.event}>{e.event}</span>
              <span className="dbg-brief">{brief(e)}</span>
            </summary>
            <Json value={e.data} />
          </details>
        </li>
      ))}
    </ol>
  );
}

function brief({ event, data }: { event: string; data: any }) {
  const ms_ = data?.latency_ms != null ? ` · ${ms(data.latency_ms)}` : "";
  if (event === "stt") return `"${data?.text ?? ""}"${ms_}`;
  if (event === "llm_round") return `round ${data?.round}${data?.tool_calls?.length ? " → " + data.tool_calls.join(", ") : ""}${ms_}`;
  if (event === "tool_call") return `${data?.name}(${JSON.stringify(data?.args ?? {}).slice(0, 80)})`;
  if (event === "tool_result") return `${data?.name} ${data?.ok ? "ok" : "error"} · ${data?.size_chars ?? 0} chars${ms_}`;
  if (event === "reply") return `${(data?.text ?? "").slice(0, 80)}${ms_}`;
  if (event === "tts") return `${data?.bytes ?? 0} bytes${ms_}`;
  if (event === "user") return `"${data?.text ?? ""}"`;
  return JSON.stringify(data).slice(0, 80);
}

function Messages() {
  const messages = useDebugStore((s) => s.messages);
  const clearMessages = useDebugStore((s) => s.clearMessages);
  const [filter, setFilter] = useState("");
  const shown = messages.filter((m) => !filter || JSON.stringify(m.payload).toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="dbg-messages">
      <div className="dbg-toolbar">
        <input className="dbg-input" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter messages" />
        <button type="button" className="dbg-button" onClick={clearMessages}>Clear</button>
        <span className="dbg-count">{shown.length} / {messages.length}</span>
      </div>
      <ol className="dbg-events">
        {shown.slice(-100).map((m) => (
          <li key={m.id}>
            <details className="dbg-details">
              <summary>
                <span className="dbg-time">{clock(m.at)}</span>
                <span className="dbg-dir" data-direction={m.direction}>{m.direction === "in" ? "⇩" : "⇧"}</span>
                <span className="dbg-brief">{typeof m.payload === "string" ? m.payload : `${m.payload?.type ?? "?"} ${JSON.stringify(m.payload).slice(0, 90)}`}</span>
              </summary>
              <Json value={m.payload} />
            </details>
          </li>
        ))}
      </ol>
    </div>
  );
}

function State() {
  // Select primitives one by one: an object-returning selector is a new value
  // every render and sends React's external-store hook into a loop.
  const status = useVoiceStore((s) => s.status);
  const mode = useVoiceStore((s) => s.mode);
  const expression = useVoiceStore((s) => s.expression);
  const cards = useVoiceStore((s) => s.cards.length);
  const history = useVoiceStore((s) => s.history.length);
  const streaming = useChatStore((s) => s.streaming);
  const activeId = useChatStore((s) => s.active?.id ?? null);
  const messages = useChatStore((s) => s.active?.messages?.length ?? 0);
  const voice = { status, mode, expression, cards, history };
  const chat = { streaming, active: activeId, messages };
  const [server, setServer] = useState<any>(null);
  useEffect(() => {
    let live = true;
    const load = () => fetch("/api/status").then((r) => r.json()).then((d) => live && setServer(d)).catch(() => live && setServer({ ok: false }));
    load();
    const t = setInterval(load, 5000);
    return () => { live = false; clearInterval(t); };
  }, []);
  return (
    <div className="dbg-state">
      <section><h4>Voice</h4><Json value={voice} /></section>
      <section><h4>Chat</h4><Json value={chat} /></section>
      <section><h4>Server</h4><Json value={server ?? "loading"} /></section>
    </div>
  );
}

export default function DebugBar() {
  const enabled = useVoiceStore((s) => s.debugEnabled);
  const turns = useDebugStore((s) => s.turns);
  const clear = useDebugStore((s) => s.clear);
  const status = useVoiceStore((s) => s.status);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("timeline");
  const [selected, setSelected] = useState<number | null>(null);
  const [serverOk, setServerOk] = useState<boolean | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const ping = () => fetch("/api/status").then((r) => r.json()).then((d) => live && setServerOk(Boolean(d.ok && d.sidecar))).catch(() => live && setServerOk(false));
    ping();
    const t = setInterval(ping, 10000);
    return () => { live = false; clearInterval(t); };
  }, [enabled]);

  if (!enabled) return null;
  const turn = (selected != null && turns.find((t) => t.id === selected)) || turns[turns.length - 1] || null;
  const copy = () => { if (turn) navigator.clipboard?.writeText(JSON.stringify(turn, null, 2)).catch(() => {}); };

  return (
    <aside className="dbg" data-open={open} aria-label="Debug bar">
      <div className="dbg-strip">
        <button type="button" className="dbg-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="dbg-brand">debug</span>
          <span className="dbg-chevron" aria-hidden="true">{open ? "▾" : "▴"}</span>
        </button>
        <div className="dbg-tiles">
          <Tile label="status" value={status} />
          <Tile label="turn" value={turn ? ms(turn.total) : "–"} tone={turn && turn.total > 4000 ? "warn" : undefined} />
          <Tile label="stt" value={turn ? ms(turn.stages.stt) : "–"} />
          <Tile label="llm" value={turn ? ms(turn.stages.llm) : "–"} />
          <Tile label="tts" value={turn ? ms(turn.stages.tts) : "–"} />
          <Tile label="tools" value={turn ? String(turn.toolCalls) : "–"} />
          <Tile label="server" value={serverOk == null ? "…" : serverOk ? "ok" : "down"} tone={serverOk === false ? "bad" : serverOk ? "ok" : undefined} />
        </div>
      </div>
      {open && (
        <div className="dbg-panel">
          <div className="dbg-panel-head">
            <div className="dbg-tabs" role="tablist">
              {TABS.map((t) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} className="dbg-tab" onClick={() => setTab(t)}>{t}</button>
              ))}
            </div>
            <div className="dbg-turnpick">
              <label className="dbg-count">Turn
                <select className="dbg-select" value={turn?.id ?? ""} onChange={(e) => setSelected(Number(e.target.value))} aria-label="Select turn">
                  {turns.map((t) => <option key={t.id} value={t.id}>#{t.id} · {t.mode} · {clock(t.startedAt)}</option>)}
                </select>
              </label>
              <button type="button" className="dbg-button" onClick={copy} disabled={!turn}>Copy</button>
              <button type="button" className="dbg-button" onClick={clear}>Clear</button>
            </div>
          </div>
          <div className="dbg-body">
            {!turn && tab !== "messages" && tab !== "state" && <p className="dbg-empty">No turns yet. Speak or send a chat message.</p>}
            {turn && tab === "timeline" && <Timeline turn={turn} />}
            {turn && tab === "events" && <Events turn={turn} />}
            {tab === "messages" && <Messages />}
            {tab === "state" && <State />}
          </div>
        </div>
      )}
    </aside>
  );
}
