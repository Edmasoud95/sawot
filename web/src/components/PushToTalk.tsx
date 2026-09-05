import { useVoiceStore } from "../store";

const LABELS = {
  connecting: "Connecting…",
  idle: "Hold to talk",
  recording: "Release to send",
  thinking: "Thinking…",
  speaking: "Speaking…",
};

export default function PushToTalk({ onStart, onStop }) {
  const status = useVoiceStore((s) => s.status);
  const recording = status === "recording";
  const busy = status === "thinking" || status === "speaking";
  return (
    <div className="talk-dock">
      <button
        aria-label="Hold to talk"
        title="Hold to talk"
        disabled={status === "connecting" || busy}
        onKeyDown={(e) => {
          if ((e.key === " " || e.key === "Enter") && !e.repeat) {
            e.preventDefault();
            onStart();
          }
        }}
        onKeyUp={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            onStop();
          }
        }}
        onBlur={onStop}
        onPointerDown={(e) => {
          e.preventDefault();
          onStart();
        }}
        onPointerUp={onStop}
        onPointerCancel={onStop}
        onPointerLeave={onStop}
        className={`talk-button ${recording ? "is-recording" : ""}`}
      >
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
        className="talk-status"
      >
        {LABELS[status]}
      </p>
    </div>
  );
}
