import { useEffect, useState } from "react";
import { useVoiceStore } from "../../store";
import { Disclosure, Select } from "./fields";

export default function LiveVoiceSettings() {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<any>(null);
  const [error, setError] = useState("");
  const live = useVoiceStore(s => s.liveMode);
  const provider = useVoiceStore(s => s.liveProviderId);
  const voice = useVoiceStore(s => s.liveVoice);
  useEffect(() => {
    let disposed = false;
    fetch("/api/live/config", { cache: "no-store" }).then(r => {
      if (!r.ok) throw new Error();
      return r.json();
    }).then(body => {
      if (disposed) return;
      setConfig(body);
      const state = useVoiceStore.getState();
      state.setLiveVoiceEnabled(body.enabled === true);
      if (body.providers?.length && !state.liveProviderId) state.setLiveProviderId(body.providers[0].id);
      if (body.voices?.length && !body.voices.includes(state.liveVoice)) state.setLiveVoice(body.voices[0]);
    }).catch(() => { if (!disposed) setError("Couldn't load Live voice options."); });
    return () => { disposed = true; };
  }, []);
  const missingProvider = !!provider && config && !config.providers.some(p => p.id === provider);
  return <Disclosure id="live-voice" title="Live voice" summary={live ? "Live trial" : "Standard"} open={open} onToggle={() => setOpen(!open)}>
    <Select label="Conversation mode" value={live ? "live" : "standard"} options={["standard", "live"]}
      labels={{ standard: "Standard", live: "Live trial · GPT-Live" }}
      onChange={value => useVoiceStore.getState().setLiveMode(value === "live")} />
    <p className="text-sm leading-snug text-zinc-500">Live listens continuously and lets you interrupt by speaking. Microphone audio goes to OpenAI while connected, with an AI-generated voice. Paid API usage applies. It ends after 30 seconds of inactivity.</p>
    <p className="text-sm leading-snug text-zinc-500">Home actions and web search use your selected Assistant model and existing connections. Personality follows Assistant settings. Switch to Standard to send pictures. These voice choices apply to this device.</p>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    {config && <>
      <Select label="Live OpenAI account" value={provider} options={[...(missingProvider ? [provider] : []), ...config.providers.map(p => p.id)]}
        labels={{ ...Object.fromEntries(config.providers.map(p => [p.id, p.name])), ...(missingProvider ? { [provider]: "Unavailable account — choose another" } : {}) }} disabled={!config.providers.length}
        onChange={value => useVoiceStore.getState().setLiveProviderId(value)} />
      {!config.providers.length && <p className="text-sm text-zinc-500">Add your OpenAI API key in Connections to start a Live session.</p>}
      <Select label="Live voice" value={voice} options={config.voices} onChange={value => useVoiceStore.getState().setLiveVoice(value)} />
    </>}
  </Disclosure>;
}
