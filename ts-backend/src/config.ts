import { migrateHaUrl } from "./connections.js";
import { SettingsStore, migrateCredentials } from "./settingsStore.js";
import { normalizePersonality } from "./agent.js";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse } from "yaml";
import { config as loadEnv } from "dotenv";
import { parseAllowedOrigins } from "./voiceOrigin.js";

export interface Config {
  haUrl: string;
  haToken: string;
  llmUrl: string;
  llmModel: string;
  sttModel: string;
  sttLanguage: string;
  ttsVoice: string;
  ttsLangCode: string;
  assistantName: string;
  assistantPersonality: "sassy" | "plain" | "custom";
  assistantPersonalityPrompt: string;
  /** Brave Search API key; empty disables the voice and chat web tools. */
  braveApiKey: string;
  host: string;
  port: number;
  allowedOrigins: string[];
  allowedControls?: Record<string, string[]>;
  sslCertfile?: string;
  sslKeyfile?: string;
  sidecarUrl: string;
  /** Where settings.json, data/ and models/ live (SAWOT_DATA_DIR, else
   *  beside config.yaml). */
  dataDir: string;
}

function resolveUp(path: string): string {
  if (existsSync(path)) return path;
  const parent = join("..", path);
  if (existsSync(parent)) return parent;
  return path;
}

// Environment variable -> path into the YAML document; the environment wins,
// so a container can run with no config.yaml at all.
const ENV_KEYS: Record<string, string[]> = {
  HA_URL: ["home_assistant", "url"],
  LLM_URL: ["llm", "url"],
  LLM_MODEL: ["llm", "model"],
  STT_MODEL: ["stt", "model"],
  STT_LANGUAGE: ["stt", "language"],
  TTS_VOICE: ["tts", "voice"],
  TTS_LANG_CODE: ["tts", "lang_code"],
  ASSISTANT_NAME: ["assistant", "name"],
  ASSISTANT_PERSONALITY: ["assistant", "personality"],
  ASSISTANT_PERSONALITY_PROMPT: ["assistant", "personality_prompt"],
  BRAVE_API_KEY: ["search", "brave_api_key"],
  SERVER_HOST: ["server", "host"],
  SERVER_PORT: ["server", "port"],
  TLS_CERTFILE: ["tls", "certfile"],
  TLS_KEYFILE: ["tls", "keyfile"],
};

const DEFAULTS: Record<string, string | number> = {
  "llm.url": "http://localhost:1234/v1",
  "llm.model": "",
  "stt.model": "parakeet-unified-en",
  "stt.language": "en",
  "tts.voice": "af_heart",
  "tts.lang_code": "a",
  "assistant.name": "Rita",
  "assistant.personality": "sassy",
  "assistant.personality_prompt": "",
  "search.brave_api_key": "",
  "server.host": "0.0.0.0",
  "server.port": 8765,
};

function lookup(raw: any, path: string[]): unknown {
  let node = raw;
  for (const key of path) {
    if (!node || typeof node !== "object" || !(key in node)) return undefined;
    node = node[key];
  }
  return node;
}

export function loadConfig(path = "config.yaml", env: NodeJS.ProcessEnv = process.env): Config {
  const cfgPath = resolveUp(path);
  const cfgDir = dirname(cfgPath);
  // .env beside the config file fills in unset variables only.
  if (env === process.env) loadEnv({ path: join(cfgDir, ".env"), quiet: true });
  const raw: any = existsSync(cfgPath) ? parse(readFileSync(cfgPath, "utf8")) ?? {} : {};

  const get = (...p: string[]): unknown => {
    for (const [envKey, envPath] of Object.entries(ENV_KEYS)) {
      if (envPath.join(".") === p.join(".") && env[envKey]) return env[envKey];
    }
    const value = lookup(raw, p);
    return value === undefined || value === null ? DEFAULTS[p.join(".")] : value;
  };

  const dataDir = env.SAWOT_DATA_DIR ?? resolve(cfgDir);
  const haUrl = migrateHaUrl(new SettingsStore(join(dataDir, "settings.json")), get("home_assistant", "url"));
  const credentials = migrateCredentials(new SettingsStore(join(dataDir, "settings.json")), {
    haToken: env.HA_TOKEN ?? "",
    hfToken: env.HF_TOKEN || env.HUGGING_FACE_HUB_TOKEN || "",
    braveApiKey: String(get("search", "brave_api_key") ?? ""),
  });
  return {
    haUrl,
    haToken: credentials.haToken,
    llmUrl: String(get("llm", "url")).replace(/\/+$/, ""),
    llmModel: String(get("llm", "model")),
    sttModel: String(get("stt", "model")),
    sttLanguage: String(get("stt", "language")),
    ttsVoice: String(get("tts", "voice")),
    ttsLangCode: String(get("tts", "lang_code")),
    assistantName: String(get("assistant", "name")),
    assistantPersonality: normalizePersonality(get("assistant", "personality")),
    assistantPersonalityPrompt: String(get("assistant", "personality_prompt") ?? ""),
    braveApiKey: credentials.braveApiKey,
    host: String(get("server", "host")),
    port: Number(get("server", "port")),
    allowedOrigins: parseAllowedOrigins(env.SAWOT_ALLOWED_ORIGINS !== undefined
      ? env.SAWOT_ALLOWED_ORIGINS.split(",").map(value => value.trim()).filter(Boolean)
      : raw.server?.allowed_origins ?? []),
    allowedControls: raw.controls,
    sslCertfile: get("tls", "certfile") as string | undefined,
    sslKeyfile: get("tls", "keyfile") as string | undefined,
    sidecarUrl: env.SAWOT_SIDECAR_URL ?? "http://127.0.0.1:8766",
    dataDir,
  };
}
