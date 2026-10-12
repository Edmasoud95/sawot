import MotionButton from "../MotionButton";
export default function SectionNav({ sections, value, onChange }) {
  return (
    <nav className="settings-nav" role="tablist" aria-label="Settings sections">
      {sections.map((s) => (
        <MotionButton
          key={s.key}
          id={`settings-tab-${s.key}`}
          role="tab"
          aria-selected={value === s.key}
          onClick={() => onChange(s.key)}
          className={`settings-nav-item ${value === s.key ? "is-active" : ""}`}
        >
          {s.label}
        </MotionButton>
      ))}
    </nav>
  );
}
