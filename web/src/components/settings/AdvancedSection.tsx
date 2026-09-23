import { SectionTitle, Toggle } from "./fields";

export default function AdvancedSection({ debugEnabled, toggleDebug }) {
  return <div className="flex flex-col gap-3">
    <SectionTitle>Developer</SectionTitle>
    <Toggle label="Debug bar"
      hint="A diagnostics strip along the bottom: turn timings, events, raw traffic, and live state."
      checked={debugEnabled} onChange={() => toggleDebug()} />
  </div>;
}
