import LivePromptSettings from "./LivePromptSettings";
import { useRef } from "react";
import { SectionTitle, Toggle } from "./fields";

export default function AdvancedSection({ data, update, debugEnabled, toggleDebug }) {
  const saving = useRef(false);
  return <div className="flex flex-col gap-3">
    <SectionTitle>Experimental</SectionTitle>
    {data && <Toggle label="Enable Live voice trial"
      hint="Unlock continuous OpenAI voice in Speech settings. Off by default. Disabling ends active Live sessions."
      checked={data.liveVoiceEnabled === true} onChange={async (enabled) => {
        if (saving.current) return;
        saving.current = true;
        try { await update({ liveVoiceEnabled: enabled }); } finally { saving.current = false; }
      }} />}
    {data?.liveVoiceEnabled && <LivePromptSettings data={data} update={update} />}
    <SectionTitle>Developer</SectionTitle>
    <Toggle label="Debug bar"
      hint="A diagnostics strip along the bottom: turn timings, events, raw traffic, and live state."
      checked={debugEnabled} onChange={() => toggleDebug()} />
  </div>;
}
