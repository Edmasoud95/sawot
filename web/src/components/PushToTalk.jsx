import { useVoiceStore } from "../store";

const LABELS = {
  connecting: "connecting",
  idle: "hold to talk",
  recording: "listening",
  thinking: "thinking",
  speaking: "speaking",
};

const DOT_COLORS = {
  connecting: "bg-zinc-600",
  idle: "bg-aurora-teal",
  recording: "bg-aurora-ember",
  thinking: "bg-aurora-violet",
  speaking: "bg-aurora-ice",
};

export default function PushToTalk({ onStart, onStop }) {
  const status = useVoiceStore((s) => s.status);
  const recording = status === "recording";
  const busy = status === "thinking" || status === "speaking";
  return (
    <div className="row-start-3 flex flex-col items-center gap-4 pt-4">
      <button
        aria-label="Hold to talk"
        onPointerDown={(e) => {
          e.preventDefault();
          onStart();
        }}
        onPointerUp={onStop}
        onPointerCancel={onStop}
        onPointerLeave={onStop}
        className={`group relative grid h-[80px] w-[80px] touch-none select-none place-items-center rounded-full border backdrop-blur-md transition-all duration-300 ${
          recording
            ? "scale-110 border-aurora-ember/50 bg-aurora-ember/15 text-aurora-ember shadow-[0_0_60px_rgba(255,157,107,0.35),inset_0_0_24px_rgba(255,157,107,0.12)]"
            : "border-white/12 bg-white/[0.04] text-zinc-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] hover:border-white/25 hover:bg-white/[0.08] active:scale-95"
        }`}
      >
        {/* breathing outline ring while the mic is hot */}
        <span
          aria-hidden="true"
          className={`absolute inset-0 rounded-full border border-aurora-ember/40 transition-opacity duration-300 ${
            recording ? "animate-ping opacity-60" : "opacity-0"
          }`}
        />
        <svg
          viewBox="0 0 24 24"
          width="26"
          height="26"
          fill="currentColor"
          aria-hidden="true"
          className="transition-transform duration-300 group-active:scale-90"
        >
          <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z" />
        </svg>
      </button>
      <p
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 font-mono text-[0.68rem] font-light uppercase tracking-[0.28em] text-zinc-500"
      >
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 rounded-full transition-colors duration-500 ${DOT_COLORS[status]} ${
            busy || status === "connecting" ? "animate-pulse-dot" : ""
          }`}
        />
        {LABELS[status]}
      </p>
    </div>
  );
}
