import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import { config as loadEnv } from "dotenv";

export interface Config {
  haUrl: string;
  haToken: string;
  lmstudioUrl: string;
  lmstudioModel: string;
  sttModel: string;
  sttDevice: string;
  sttLanguage: string;
  ttsVoice: string;
  ttsLangCode: string;
  assistantName: string;
  assistantSassy: boolean;
  host: string;
  port: number;
  allowedControls?: Record<string, string[]>;
  sslCertfile?: string;
  sslKeyfile?: string;
  sidecarUrl: string;
}

function resolveUp(path: string): string {
  if (existsSync(path)) return path;
  const parent = join("..", path);
  if (existsSync(parent)) return parent;
  return path;
}

export function loadConfig(path = "config.yaml"): Config {
  const cfgPath = resolveUp(path);
  loadEnv({ path: join(dirname(cfgPath), ".env") });
  const raw: any = parse(readFileSync(cfgPath, "utf8"));

  const token = process.env.HA_TOKEN;
  if (!token) throw new Error("HA_TOKEN is not set (put it in .env)");

  const assistant = raw.assistant ?? {};
  return {
    haUrl: String(raw.home_assistant.url).replace(/\/+$/, ""),
    haToken: token,
    lmstudioUrl: String(raw.lm_studio.url).replace(/\/+$/, ""),
    lmstudioModel: raw.lm_studio.model,
    sttModel: raw.stt.model,
    sttDevice: raw.stt.device ?? "cuda",
    sttLanguage: raw.stt.language ?? "en",
    ttsVoice: raw.tts.voice,
    ttsLangCode: raw.tts.lang_code ?? "a",
    assistantName: assistant.name ?? "Rita",
    assistantSassy: (assistant.personality ?? "sassy") !== "plain",
    host: raw.server?.host ?? "0.0.0.0",
    port: Number(raw.server?.port ?? 8765),
    allowedControls: raw.controls,
    sslCertfile: raw.tls?.certfile,
    sslKeyfile: raw.tls?.keyfile,
    sidecarUrl: process.env.SAWOT_SIDECAR_URL ?? "http://127.0.0.1:8766",
  };
}
