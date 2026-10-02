import { useEffect, useState } from 'react';
import { BUTTON_CLS, FIELD_CLS, Disclosure } from './fields';

function PromptEditor({ label, value, fallback, field, update }) {
  const [draft, setDraft] = useState(value || fallback);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDraft(value || fallback); }, [value, fallback]);
  async function save(text: string) {
    setBusy(true);
    try { if (await update({ [field]: text })) setDraft(text || fallback); } finally { setBusy(false); }
  }
  return <div className="flex flex-col gap-3">
    <label className="flex flex-col gap-2"><span className="text-base text-zinc-200">{label}</span>
      <textarea aria-label={label} className={`${FIELD_CLS} resize-y text-sm leading-relaxed`} rows={10} maxLength={8000}
        value={draft} disabled={busy} onChange={e => setDraft(e.target.value)} />
    </label>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={BUTTON_CLS} disabled={busy || draft === (value || fallback)} onClick={() => save(draft)}>Save {label.toLowerCase()}</button>
      <button type="button" className={BUTTON_CLS} disabled={busy || (!value && draft === fallback)} onClick={() => save('')}>Reset {label.toLowerCase()}</button>
    </div>
  </div>;
}

export default function LivePromptSettings({ data, update }) {
  const [open, setOpen] = useState(false);
  if (!data?.livePromptDefaults) return null;
  return <Disclosure id="live-prompts" title="Live system prompts" summary="View and edit" open={open} onToggle={() => setOpen(!open)}>
    <div className="flex flex-col gap-5">
      <p className="text-sm text-zinc-500">Reconnect Live for conversation or personality changes. Tool prompt changes apply to the next task. The conversation prompt controls speech and acting; the tool prompt guides home actions and web searches.</p>
      <p className="text-sm text-zinc-500">Keep {'{identity}'}, {'{personality}'}, {'{backchannel_policy}'}, {'{interruption_policy}'} and {'{capabilities}'} to follow the selected character and available connections. {'{name}'} inserts the configured name.</p>
      <PromptEditor label="Conversation prompt" value={data.liveVoicePrompt} fallback={data.livePromptDefaults.conversation} field="liveVoicePrompt" update={update} />
      <details className="text-sm text-zinc-400"><summary className="cursor-pointer py-2">Conversation prompt with current settings</summary>
        <pre className="whitespace-pre-wrap break-words leading-relaxed">{data.liveEffectivePrompt}</pre></details>
      <PromptEditor label="Tool prompt" value={data.liveBackendPrompt} fallback={data.livePromptDefaults.backend} field="liveBackendPrompt" update={update} />
      <details className="text-sm text-zinc-400"><summary className="cursor-pointer py-2">Tool prompt with current devices</summary>
        <pre className="whitespace-pre-wrap break-words leading-relaxed">{data.liveEffectiveBackendPrompt}</pre></details>
      <p className="text-sm text-zinc-500">Keep {'{device_context}'} in the tool prompt to include SAWOT’s device instructions and current device list. Search guidance is supplied when search is connected. Tool access still depends on configured connections.</p>
    </div>
  </Disclosure>;
}
