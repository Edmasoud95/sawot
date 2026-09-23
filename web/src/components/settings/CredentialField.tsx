import { useState } from "react";
import { FIELD_CLS } from "./fields";

export default function CredentialField({ label, setting, configured, update }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(next: string) {
    setBusy(true);
    try {
      if (await update({ [setting]: next })) setValue("");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="flex flex-col gap-2" onSubmit={e => { e.preventDefault(); void save(value.trim()); }}>
      <label htmlFor={`credential-${setting}`} className="text-base text-zinc-200">{label}</label>
      <span className="text-sm text-zinc-500">{configured ? "Configured" : "Not configured"}</span>
      <input id={`credential-${setting}`} type="password" autoComplete="new-password"
        value={value} onChange={e => setValue(e.target.value)} disabled={busy}
        placeholder={configured ? "Enter a replacement" : "Enter credential"}
        maxLength={8192} spellCheck={false} className={FIELD_CLS} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy || !value.trim()}
          className="min-h-11 rounded-full border border-white/10 px-4 py-2 text-base text-zinc-200 disabled:opacity-50">
          {busy ? "Saving…" : configured ? "Replace" : "Save"}
        </button>
        {configured && <button type="button" disabled={busy} onClick={() => void save("")}
          aria-label={`Remove ${label}`}
          className="min-h-11 rounded-full border border-white/10 px-4 py-2 text-base text-zinc-400 disabled:opacity-50">Remove</button>}
      </div>
    </form>
  );
}
