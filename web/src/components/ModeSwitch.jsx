import { useVoiceStore } from "../store";

const OrbIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <circle cx="12" cy="12" r="8" />
  </svg>
);

const CardsIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
);

const ChatIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const MODES = [
  { key: "orb", label: "Switch to orb", Icon: OrbIcon },
  { key: "cards", label: "Switch to control cards", Icon: CardsIcon },
  { key: "chat", label: "Switch to chat", Icon: ChatIcon },
];

export default function ModeSwitch() {
  const mode = useVoiceStore((s) => s.mode);
  const setMode = useVoiceStore((s) => s.setMode);

  return (
    <div
      className="flex items-center rounded-full border border-white/10 bg-white/[0.04] backdrop-blur-md"
      role="group"
      aria-label="View mode"
    >
      {MODES.map(({ key, label, Icon }) => (
        <button
          key={key}
          onClick={() => setMode(key)}
          aria-label={label}
          aria-pressed={mode === key}
          className={`grid h-9 w-9 place-items-center rounded-full transition-colors duration-200 ${
            mode === key
              ? "bg-white/10 text-zinc-100"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          <Icon />
        </button>
      ))}
    </div>
  );
}
