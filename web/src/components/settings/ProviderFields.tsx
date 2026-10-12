import { useState } from "react";
import { updateProviderPrivacy } from "../chat/useModels";
import { FIELD_CLS, Toggle } from "./fields";

function ProviderRow({ p, onRemove, apply }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function changePrivacy(privateMemoryAccess: boolean) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/providers/${encodeURIComponent(p.id)}/privacy`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ privateMemoryAccess }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || "Could not update private memory access.");
      updateProviderPrivacy(body.providers ?? []);
      apply(body);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not update private memory access.");
    } finally { setBusy(false); }
  }
  return (
    <div className="rounded-xl border border-white/10 p-3.5">
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 flex-col">
        <span className="flex flex-wrap items-center gap-2 text-base font-medium text-zinc-200">
          {p.name}
          {p.builtin && (
            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-sm uppercase tracking-wider text-zinc-400">
              built-in
            </span>
          )}
        </span>
        <span className="truncate text-sm text-zinc-500">{p.baseUrl}</span>
        <span className={`text-sm ${p.state === "error" || p.error ? "text-red-400/90" : "text-zinc-500"}`}>
          {p.state === "pending" ? "Loading models…" : p.error ? "Unreachable — check the URL and key" : `${p.models.length} models`}
        </span>
      </div>
      {!p.builtin && (
        <button
          onClick={() => onRemove(p)}
          aria-label={`Remove provider ${p.name}`}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/10 text-zinc-500 transition-colors duration-300 hover:border-red-400/50 hover:text-red-300"
        >
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      )}
    </div>
    <div className="mt-3" aria-busy={busy}>
      <Toggle label="Allow private memories" hint="Allow this provider to receive private memories and private conversations, including speech." checked={p.privateMemoryAccess === true} onChange={changePrivacy} />
      {error && <p role="alert" className="mt-2 text-sm text-red-300">{error}</p>}
    </div>
    </div>
  );
}

function AddProviderForm({ apply }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  async function add(e) {
    e.preventDefault();
    setFormError("");
    setBusy(true);
    try {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, baseUrl: url, apiKey: key || undefined }),
      });
      const body = await res.json();
      if (!res.ok) {
        setFormError(body.detail || "Couldn't add the provider — try again.");
        return;
      }
      apply(body);
      setName("");
      setUrl("");
      setKey("");
    } catch {
      setFormError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={add} className="flex flex-col gap-2.5">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name (e.g. OpenRouter)"
        aria-label="Provider name"
        required
        className={FIELD_CLS}
      />
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="Base URL (e.g. https://openrouter.ai/api/v1)"
        aria-label="Provider base URL"
        required
        type="url"
        className={FIELD_CLS}
      />
      <input
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder="API key (optional for local servers)"
        aria-label="Provider API key"
        type="password"
        autoComplete="off"
        className={FIELD_CLS}
      />
      {formError && (
        <p className="text-sm leading-snug text-red-400/90">{formError}</p>
      )}
      <button
        type="submit"
        disabled={busy || !name.trim() || !url.trim()}
        className="min-h-11 self-start rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-base text-zinc-200 transition-colors duration-300 hover:border-aurora-teal/50 hover:text-zinc-100 disabled:opacity-50"
      >
        {busy ? "Checking endpoint…" : "Add provider"}
      </button>
    </form>
  );
}

export default function ProviderFields({ providers, removeProvider, onProvidersChanged }) {
  return <div className="flex flex-col gap-3">
    {providers.map(p => <ProviderRow key={p.id} p={p} onRemove={removeProvider} apply={onProvidersChanged} />)}
    <AddProviderForm apply={onProvidersChanged} />
  </div>;
}
