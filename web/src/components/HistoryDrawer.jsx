import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { useVoiceStore } from "../store";

// One line per pipeline event, dense and scannable.
function traceLine({ event, data }) {
  switch (event) {
    case "stt":
      return `stt      ${data.latency_ms}ms · "${data.text || "(empty)"}"`;
    case "llm_round":
      return `llm #${data.round}   ${data.latency_ms}ms → ${
        data.tool_calls ? `tools: ${data.tool_calls.join(", ")}` : "answer"
      }`;
    case "tool_call":
      return `  → ${data.name}(${JSON.stringify(data.args)})`;
    case "tool_result":
      return `  ← ${data.latency_ms}ms · ${data.size_chars} chars · ${data.result}`;
    case "tts":
      return `tts      ${data.latency_ms}ms · ${(data.bytes / 1024).toFixed(0)}kB`;
    default:
      return `${event} ${JSON.stringify(data)}`;
  }
}

function Trace({ trace }) {
  return (
    <ol className="mt-2 flex flex-col gap-1 border-l border-white/10 pl-3">
      {trace.events.map((e, i) => (
        <li
          key={i}
          className={`whitespace-pre-wrap break-all font-mono text-[0.66rem] leading-relaxed ${
            e.event === "tool_result" && e.data.result?.includes('"error"')
              ? "text-red-400/90"
              : "text-zinc-500"
          }`}
        >
          {traceLine(e)}
        </li>
      ))}
    </ol>
  );
}

export default function HistoryDrawer() {
  const history = useVoiceStore((s) => s.history);
  const drawerOpen = useVoiceStore((s) => s.drawerOpen);
  const toggleDrawer = useVoiceStore((s) => s.toggleDrawer);
  const debugEnabled = useVoiceStore((s) => s.debugEnabled);
  const toggleDebug = useVoiceStore((s) => s.toggleDebug);
  const traces = useVoiceStore((s) => s.traces);
  const panel = useRef(null);
  const scrim = useRef(null);

  // Park the panel off-screen via GSAP itself — a Tailwind translate class
  // would be read as a pixel `x` offset that xPercent then adds to.
  useLayoutEffect(() => {
    gsap.set(panel.current, { xPercent: 100 });
  }, []);

  useLayoutEffect(() => {
    gsap.to(panel.current, {
      xPercent: drawerOpen ? 0 : 100,
      duration: 0.55,
      ease: "power4.out",
    });
    gsap.to(scrim.current, {
      autoAlpha: drawerOpen ? 1 : 0,
      duration: 0.4,
      ease: "power2.out",
    });
  }, [drawerOpen]);

  return (
    <>
      <button
        onClick={toggleDrawer}
        aria-label="Toggle conversation history"
        aria-expanded={drawerOpen}
        className="absolute right-5 top-[calc(16px+env(safe-area-inset-top))] z-30 grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-zinc-400 backdrop-blur-md transition-colors duration-300 hover:border-white/25 hover:text-zinc-200"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </svg>
      </button>
      <div
        ref={scrim}
        onClick={toggleDrawer}
        aria-hidden="true"
        className="invisible absolute inset-0 z-20 bg-black/40 opacity-0 backdrop-blur-[2px]"
      />
      <aside
        ref={panel}
        className="absolute inset-y-0 right-0 z-30 w-[min(85vw,380px)] overflow-y-auto border-l border-white/10 bg-ink-900/90 p-7 pt-[calc(72px+env(safe-area-inset-top))] backdrop-blur-2xl"
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 className="font-mono text-[0.65rem] font-light uppercase tracking-[0.3em] text-zinc-500">
            Conversation
          </h2>
          <button
            onClick={toggleDebug}
            aria-pressed={debugEnabled}
            className={`rounded-full border px-3 py-1 font-mono text-[0.6rem] uppercase tracking-[0.2em] transition-colors duration-300 ${
              debugEnabled
                ? "border-aurora-teal/50 bg-aurora-teal/10 text-aurora-teal"
                : "border-white/10 text-zinc-600 hover:border-white/25 hover:text-zinc-400"
            }`}
          >
            debug
          </button>
        </div>
        {history.length === 0 && (
          <p className="font-serif text-lg italic text-zinc-600">
            Nothing yet — hold the button and speak.
          </p>
        )}
        <ul className="flex flex-col gap-5">
          {history.map((turn, i) => (
            <li key={i} className="animate-rise-in">
              <span
                className={`mb-1 block font-mono text-[0.62rem] uppercase tracking-[0.22em] ${
                  turn.role === "user" ? "text-aurora-teal/60" : "text-aurora-ice/60"
                }`}
              >
                {turn.role === "user" ? "you" : "assistant"}
              </span>
              <p
                className={`leading-snug ${
                  turn.role === "user"
                    ? "font-mono text-[0.82rem] font-light text-zinc-400"
                    : "font-serif text-[1.05rem] text-zinc-100"
                }`}
              >
                {turn.text}
              </p>
              {debugEnabled &&
                turn.role === "user" &&
                turn.traceId != null &&
                (() => {
                  const trace = traces.find((t) => t.id === turn.traceId);
                  return trace ? <Trace trace={trace} /> : null;
                })()}
            </li>
          ))}
        </ul>
      </aside>
    </>
  );
}
