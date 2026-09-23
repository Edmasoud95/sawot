import { useEffect, useState } from "react";
import { BUTTON_CLS, FIELD_CLS } from "./fields";

export default function HomeAssistantFields({ url, hasToken, update }) {
  const [address, setAddress] = useState(url ?? "");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setAddress(url ?? ""), [url]);
  async function save(patch) {
    setBusy(true);
    try { if (await update(patch)) setToken(""); }
    finally { setBusy(false); }
  }
  return <form className="flex flex-col gap-3" onSubmit={event => {
    event.preventDefault();
    void save({ haUrl: address.trim(), ...(token.trim() ? { haToken: token.trim() } : {}) });
  }}>
    <label className="flex flex-col gap-1.5">
      <span className="text-base text-zinc-200">Server URL</span>
      <input aria-label="Home Assistant server URL" type="url" value={address} onChange={event => setAddress(event.target.value)}
        placeholder="e.g. http://homeassistant.local:8123" autoComplete="url" spellCheck={false}
        maxLength={2048} disabled={busy} className={FIELD_CLS} />
    </label>
    <label className="flex flex-col gap-1.5">
      <span className="text-base text-zinc-200">Long-lived access token</span>
      <input aria-label="Home Assistant long-lived access token" type="password" value={token} onChange={event => setToken(event.target.value)}
        placeholder={hasToken ? "Leave blank to keep the saved token" : "Paste your token"} autoComplete="new-password"
        spellCheck={false} maxLength={8192} disabled={busy} className={FIELD_CLS} />
    </label>
    <div className="flex flex-wrap gap-2">
      <button type="submit" className={BUTTON_CLS} disabled={busy || (address.trim() === (url ?? "") && !token.trim())}>
        {busy ? "Saving…" : "Save"}
      </button>
      {hasToken && <button type="button" className={BUTTON_CLS} disabled={busy} onClick={() => void save({ haToken: "" })}>Remove token</button>}
    </div>
  </form>;
}
