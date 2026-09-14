import { useState } from "react";
import { Disclosure, FIELD_CLS, SectionTitle, Skeleton, Toggle } from "./fields";

function ProviderRow({ p, onRemove }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5">
      <div className="flex min-w-0 flex-col">
        <span className="flex items-center gap-2 text-[0.85rem] font-medium text-zinc-200">
          {p.name}
          {p.builtin && (
            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[0.55rem] uppercase tracking-wider text-zinc-400">
              built-in
            </span>
          )}
        </span>
        <span className="truncate text-[0.72rem] text-zinc-500">{p.baseUrl}</span>
        <span className={`text-[0.72rem] ${p.state === "error" || p.error ? "text-red-400/90" : "text-zinc-500"}`}>
          {p.state === "pending" ? "Loading models…" : p.error ? "Unreachable — check the URL and key" : `${p.models.length} models`}
        </span>
      </div>
      {!p.builtin && (
        <button
          onClick={() => onRemove(p)}
          aria-label={`Remove provider ${p.name}`}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/10 text-zinc-500 transition-colors duration-300 hover:border-red-400/50 hover:text-red-300"
        >
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      )}
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
        <p className="text-[0.75rem] leading-snug text-red-400/90">{formError}</p>
      )}
      <button
        type="submit"
        disabled={busy || !name.trim() || !url.trim()}
        className="self-start rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-[0.8rem] text-zinc-200 transition-colors duration-300 hover:border-aurora-teal/50 hover:text-zinc-100 disabled:opacity-50"
      >
        {busy ? "Checking endpoint…" : "Add provider"}
      </button>
    </form>
  );
}

export default function GeneralSection({ data, debugEnabled, toggleDebug, removeProvider, onProvidersChanged }) {
  const [openRow, setOpenRow] = useState(null);
  const toggle = (key) => setOpenRow((cur) => (cur === key ? null : key));
  const providers = data?.providers ?? [];
  if (!data) return <Skeleton />;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col">
        <Disclosure
          id="providers"
          title="Providers"
          summary={providers.length === 1 ? "1 provider" : `${providers.length} providers`}
          open={openRow === "providers"}
          onToggle={() => toggle("providers")}
        >
          <div className="flex flex-col gap-3">
            {providers.map((p) => (
              <ProviderRow key={p.id} p={p} onRemove={removeProvider} />
            ))}
            <AddProviderForm apply={onProvidersChanged} />
          </div>
        </Disclosure>
      </div>
      <div className="flex flex-col gap-3">
        <SectionTitle>Developer</SectionTitle>
        <Toggle
          label="Debug bar"
          hint="A diagnostics strip along the bottom: turn timings, events, raw traffic, and live state."
          checked={debugEnabled}
          onChange={() => toggleDebug()}
        />
      </div>
    </div>
  );
}
