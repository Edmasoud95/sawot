import { useEffect, useState } from "react";
import { API_BASE } from "../../lib/config";

// Module-level cache so ChatHeader and Composer share one GET /api/settings.
let cache = null;
let inflight = null;

function fetchSettings() {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = fetch(`${API_BASE}/api/settings`)
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json();
      })
      .then((d) => {
        cache = {
          models: Array.isArray(d.models) ? d.models : [],
          providers: Array.isArray(d.providers) ? d.providers : [],
        };
        return cache;
      })
      .catch((e) => {
        inflight = null; // allow a retry on next mount
        throw e;
      });
  }
  return inflight;
}

export function fetchModels() {
  return fetchSettings().then((d) => d.models);
}

function useSettingsField(field) {
  const [value, setValue] = useState(cache?.[field] ?? []);
  useEffect(() => {
    let on = true;
    fetchSettings()
      .then((d) => on && setValue(d[field]))
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [field]);
  return value;
}

/** Provider-qualified model ids from /api/settings; [] until loaded. */
export function useModels() {
  return useSettingsField("models");
}

/** Providers with their model lists from /api/settings; [] until loaded. */
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
