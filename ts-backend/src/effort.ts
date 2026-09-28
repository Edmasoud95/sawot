/** Explicit /models extension for OpenAI-compatible servers. A reasoning flag
 * or supported_parameters entry alone cannot establish accepted effort values. */
export const EFFORT_LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;
export type EffortLevel = typeof EFFORT_LEVELS[number];
export type EffortCatalogue = Record<string, EffortLevel[]>;

// Verified 2026-09-27 against https://developers.openai.com/api/docs/models/<id>.
// Exact IDs (and dated snapshots) only: suffixes such as -pro, -chat-latest,
// and -codex have different contracts and must have their own verified entry.
const OPENAI: EffortCatalogue = {
  "gpt-6-astra": ["low", "medium", "high", "xhigh", "max"],
  "gpt-6-sol": ["none", "low", "medium", "high", "xhigh", "max"],
  "gpt-6-luna": ["none", "low", "medium", "high", "xhigh", "max"],
  "gpt-5.6-sol": ["none", "low", "medium", "high", "xhigh", "max"],
  "gpt-5.6-terra": ["none", "low", "medium", "high", "xhigh", "max"],
  "gpt-5.5": ["none", "low", "medium", "high", "xhigh"],
  "gpt-5.4": ["none", "low", "medium", "high", "xhigh"],
  "gpt-5.2": ["none", "low", "medium", "high", "xhigh"],
  "gpt-5.1": ["none", "low", "medium", "high"],
  "gpt-5": ["minimal", "low", "medium", "high"],
};

export function effortLevels(baseUrl: string, model: string, metadata?: unknown): EffortLevel[] {
  if (metadata && typeof metadata === "object" && "supported_reasoning_efforts" in metadata) {
    const values = (metadata as { supported_reasoning_efforts: unknown }).supported_reasoning_efforts;
    return Array.isArray(values) ? EFFORT_LEVELS.filter(level => values.includes(level)) : [];
  }
  // Never transfer OpenAI's contract to a proxy or similarly named local model.
  try {
    const url = new URL(baseUrl);
    if (url.origin === "https://api.deepseek.com" && ["", "/v1"].includes(url.pathname.replace(/\/+$/, ""))) {
      if (metadata && typeof metadata === "object" && "effort" in metadata) {
        const values = (metadata as any).effort?.supported_levels;
        const levels = Array.isArray(values) ? EFFORT_LEVELS.filter(level => level !== "none" && values.includes(level)) : [];
        return levels.length ? ["none", ...levels] : [];
      }
      return ["deepseek-flash", "deepseek-v4-pro"].includes(model) ? ["none", "low", "high", "max"] : [];
    }
    if (url.origin !== "https://api.openai.com" || url.pathname.replace(/\/+$/, "") !== "/v1") return [];
  } catch { return []; }
  const id = model.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  return Object.hasOwn(OPENAI, id) ? [...OPENAI[id]] : [];
}

/** LM Studio's native API describes grades separately from the on/off toggle.
 * Do not manufacture multiple effort levels for a toggle-only model. */
export function lmStudioEffortLevels(metadata: any): EffortLevel[] {
  const options = metadata?.capabilities?.reasoning?.allowed_options;
  if (!Array.isArray(options)) return [];
  const grades = EFFORT_LEVELS.filter(level => level !== "none" && options.includes(level));
  return grades.length ? [...(options.includes("off") ? ["none" as const] : []), ...grades] : [];
}

export function isDeepSeekEndpoint(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return url.origin === "https://api.deepseek.com" && ["", "/v1"].includes(url.pathname.replace(/\/+$/, ""));
  } catch { return false; }
}
