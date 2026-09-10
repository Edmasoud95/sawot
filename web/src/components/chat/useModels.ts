import { useEffect, useState } from "react";
import { API_BASE } from "../../lib/config";

// Module-level cache shared by every picker: one GET /api/settings for the
// provider list, then each provider's models loaded on its own so a slow or
// sleeping provider never holds the others back.
let cache = null;
let inflight = null;
const listeners = new Set<(c: any) => void>();
const notify = () => listeners.forEach((fn) => fn(cache));

function fetchSettings() {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = fetch(`${API_BASE}/api/settings`)
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json();
      })
      .then((d) => {
        const providers = (Array.isArray(d.providers) ? d.providers : []).map((p) => ({ ...p, state: p.state === "ready" ? "ready" : "pending" }));
        cache = { models: flatModels(providers), providers };
        for (const p of providers) loadProviderModels(p.id).then((result) => patchProvider(p.id, result));
        return cache;
      })
      .catch((e) => {
        inflight = null; // allow a retry on next mount
        throw e;
      });
  }
  return inflight;
}

const flatModels = (providers) => providers.flatMap((p) => p.models.map((m) => `${p.id}::${m}`));

function patchProvider(id, result) {
  if (!cache) return;
  const providers = cache.providers.map((p) => (p.id === id ? { ...p, ...result } : p));
  cache = { models: flatModels(providers), providers };
  notify();
}

/** Fetch one provider's models now; unreachable providers resolve with an
 *  error and an empty list rather than rejecting. */
export function loadProviderModels(id) {
  return fetch(`${API_BASE}/api/providers/${encodeURIComponent(id)}/models`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
    .then((d) => ({ models: Array.isArray(d.models) ? d.models : [], state: d.error ? "error" : "ready", ...(d.error ? { error: d.error } : {}) }))
    .catch((e) => ({ models: [], state: "error", error: String(e?.message ?? e) }))
    .then((result) => { patchProvider(id, result); return result; });
}

export function fetchModels() {
  return fetchSettings().then((d) => d.models);
}

function useSettingsField(field) {
  const [value, setValue] = useState(cache?.[field] ?? []);
  useEffect(() => {
    let on = true;
    const listener = (c) => on && setValue(c[field]);
    listeners.add(listener);
    fetchSettings()
      .then((d) => on && setValue(d[field]))
      .catch(() => {});
    return () => {
      on = false;
      listeners.delete(listener);
    };
  }, [field]);
  return value;
}

/** Provider-qualified model ids; [] until loaded, growing as providers answer. */
export function useModels() {
  return useSettingsField("models");
}

/** Providers with their model lists and loading state. */
export function useProviders() {
  return useSettingsField("providers");
}

/** Display name for a possibly provider-qualified model id. */
export function splitModelId(id) {
  const at = id.indexOf("::");
  return at >= 0
    ? { provider: id.slice(0, at), model: id.slice(at + 2) }
    : { provider: null, model: id };
}
