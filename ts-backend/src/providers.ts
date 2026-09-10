import OpenAI from "openai";

/** An OpenAI-compatible chat endpoint: the built-in local server from
 *  config.yaml, or a user-added provider persisted in settings.json. */
export interface ProviderSpec {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  builtin?: boolean;
}

/** Public shape — never includes the API key. */
export interface ProviderInfo {
  id: string;
  name: string;
  baseUrl: string;
  builtin: boolean;
  hasKey: boolean;
}

/** Separator for provider-qualified model ids ("local::qwen3-8b").
 *  Model ids themselves often contain "/" so a slash won't do. */
export const MODEL_SEP = "::";

/** A provider's last known model list. `state` is what the UI shows while
 *  it loads each provider on its own. */
export interface ProviderListing extends ProviderInfo {
  models: string[];
  error?: string;
  state: "pending" | "ready" | "error";
}

export function qualifyModel(providerId: string, model: string): string {
  return providerId + MODEL_SEP + model;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "provider";
}

/** How long to wait for a provider's model list. A sleeping local model host
 *  otherwise blocks the whole settings payload for the TCP connect timeout. */
export const MODEL_LIST_TIMEOUT_MS = 5000;

async function fetchModelIds(baseUrl: string, apiKey?: string, timeoutMs = MODEL_LIST_TIMEOUT_MS): Promise<string[]> {
  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = "Bearer " + apiKey;
  let resp: Response;
  try {
    resp = await fetch(baseUrl + "/models", { headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e: any) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") throw new Error(`timed out after ${timeoutMs} ms`);
    throw e;
  }
  if (!resp.ok) throw new Error("endpoint returned " + resp.status);
  const data: any = await resp.json();
  const ids = (data.data ?? []).map((m: any) => m.id).filter(Boolean);
  if (!Array.isArray(data.data)) throw new Error("no model list in response");
  return ids;
}

/** List models on an endpoint before it becomes a provider — used by the
 *  add-provider route to reject unreachable or non-OpenAI-compatible URLs. */
export async function probeEndpoint(baseUrl: string, apiKey?: string, timeoutMs = MODEL_LIST_TIMEOUT_MS): Promise<string[]> {
  return fetchModelIds(baseUrl.replace(/\/+$/, ""), apiKey, timeoutMs);
}

export class ProviderRegistry {
  private providers = new Map<string, ProviderSpec>();
  private clients = new Map<string, OpenAI>();
  readonly defaultId: string;

  private readonly timeoutMs: number;
  // Last known model list per provider, so settings can answer at once and
  // a slow or sleeping provider never holds the others back.
  private readonly cache = new Map<string, { models: string[]; error?: string }>();

  constructor(builtin: ProviderSpec, custom: ProviderSpec[] = [], options: { timeoutMs?: number } = {}) {
    this.timeoutMs = options.timeoutMs ?? MODEL_LIST_TIMEOUT_MS;
    this.defaultId = builtin.id;
    this.providers.set(builtin.id, { ...builtin, builtin: true });
    for (const p of custom) {
      if (p?.id && p?.baseUrl && !this.providers.has(p.id)) {
        this.providers.set(p.id, { ...p, builtin: false });
      }
    }
  }

  list(): ProviderInfo[] {
    return [...this.providers.values()].map((p) => ({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      builtin: !!p.builtin,
      hasKey: !!p.apiKey,
    }));
  }

  /** Custom providers only, with keys — the shape persisted to settings.json. */
  customSpecs(): ProviderSpec[] {
    return [...this.providers.values()]
      .filter((p) => !p.builtin)
      .map(({ id, name, baseUrl, apiKey }) => ({ id, name, baseUrl, ...(apiKey ? { apiKey } : {}) }));
  }

  get(id: string): ProviderSpec | undefined {
    return this.providers.get(id);
  }

  add(name: string, baseUrl: string, apiKey?: string): ProviderSpec {
    const base = slugify(name);
    let id = base;
    for (let n = 2; this.providers.has(id); n++) id = base + "-" + n;
    const spec: ProviderSpec = {
      id,
      name: name.trim(),
      baseUrl: baseUrl.replace(/\/+$/, ""),
      ...(apiKey ? { apiKey } : {}),
      builtin: false,
    };
    this.providers.set(id, spec);
    return spec;
  }

  remove(id: string): boolean {
    const p = this.providers.get(id);
    if (!p || p.builtin) return false;
    this.providers.delete(id);
    this.clients.delete(id);
    return true;
  }

  clientFor(id: string): OpenAI {
    const p = this.providers.get(id);
    if (!p) throw new Error("unknown provider: " + id);
    let client = this.clients.get(id);
    if (!client) {
      // The OpenAI SDK requires an apiKey; local servers ignore it.
      client = new OpenAI({ baseURL: p.baseUrl, apiKey: p.apiKey || "not-needed" });
      this.clients.set(id, client);
    }
    return client;
  }

  /** Split a possibly-qualified model id into a client + bare model name.
   *  Bare ids (pre-provider settings and conversations) fall back to the
   *  built-in provider. */
  resolve(model: string): { client: OpenAI; model: string; providerId: string } {
    const at = model.indexOf(MODEL_SEP);
    const prefix = at >= 0 ? model.slice(0, at) : "";
    const bare = at >= 0 ? model.slice(at + MODEL_SEP.length) : model;
    // Unknown prefixes (a removed provider) fall back to the built-in
    // provider with the bare model name, like unqualified legacy ids do.
    const providerId = this.providers.has(prefix) ? prefix : this.defaultId;
    return { client: this.clientFor(providerId), model: bare, providerId };
  }

  async modelsFor(id: string): Promise<string[]> {
    const p = this.providers.get(id);
    if (!p) throw new Error("unknown provider: " + id);
    try {
      const models = await fetchModelIds(p.baseUrl, p.apiKey, this.timeoutMs);
      this.cache.set(id, { models });
      return models;
    } catch (e: any) {
      const previous = this.cache.get(id);
      this.cache.set(id, { models: previous?.models ?? [], error: String(e?.message ?? e) });
      throw e;
    }
  }

  /** Record a list obtained elsewhere (the add-provider probe). */
  setModels(id: string, models: string[]): void {
    if (this.providers.has(id)) this.cache.set(id, { models });
  }

  /** Every provider with its last known models, without any network call. */
  listing(): ProviderListing[] {
    return this.list().map((info) => {
      const known = this.cache.get(info.id);
      if (!known) return { ...info, models: [], state: "pending" };
      return { ...info, models: known.models, ...(known.error ? { error: known.error, state: "error" as const } : { state: "ready" as const }) };
    });
  }

  /** Refresh one provider and return its listing; an unreachable provider
   *  is a result with an error, not a failure. */
  async refresh(id: string): Promise<ProviderListing> {
    if (!this.providers.has(id)) throw new Error("unknown provider: " + id);
    try { await this.modelsFor(id); } catch { /* recorded in the cache */ }
    return this.listing().find((p) => p.id === id)!;
  }

  /** Every provider with its live model list; failures become per-provider
   *  errors instead of failing the whole listing. */
  async listAllModels(): Promise<ProviderListing[]> {
    await Promise.all(this.list().map((info) => this.refresh(info.id)));
    return this.listing();
  }
}
