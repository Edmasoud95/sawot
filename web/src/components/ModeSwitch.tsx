import { useVoiceStore } from "../store";

const OrbIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <circle cx="12" cy="12" r="8" />
  </svg>
);

const ChatIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const MODES = [
  { key: "orb", label: "Voice", Icon: OrbIcon },
  { key: "chat", label: "Chat", Icon: ChatIcon },
];

export default function ModeSwitch() {
  const mode = useVoiceStore((s) => s.mode);
  const setMode = useVoiceStore((s) => s.setMode);

  return (
    <div
      className="mode-switch"
      role="group"
      aria-label="View mode"
    >
      {MODES.map(({ key, label, Icon }) => (
        <button
          key={key}
          onClick={() => setMode(key)}
          aria-label={label}
          title={label}
          aria-pressed={mode === key}
          className={`mode-button ${mode === key ? "is-active" : ""}`}
        >
          <Icon />
        </button>
      ))}
    </div>
  );
}
