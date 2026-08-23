import { useEffect, useState } from "react";
import { API_BASE } from "../../lib/config";

// Module-level cache so ChatHeader and Composer share one GET /api/settings.
let cache = null;
let inflight = null;

export function fetchModels() {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = fetch(`${API_BASE}/api/settings`)
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json();
      })
      .then((d) => {
        cache = Array.isArray(d.models) ? d.models : [];
        return cache;
      })
      .catch((e) => {
        inflight = null; // allow a retry on next mount
        throw e;
      });
  }
  return inflight;
}

/** Model list from /api/settings; [] until loaded or on error. */
export function useModels() {
  const [models, setModels] = useState(cache ?? []);
  useEffect(() => {
    let on = true;
    fetchModels()
      .then((m) => on && setModels(m))
      .catch(() => {});
    return () => {
      on = false;
    };
  }, []);
  return models;
}
