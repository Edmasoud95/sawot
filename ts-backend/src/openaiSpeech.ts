import type { ProviderInfo, ProviderSpec } from "./providers.js";

// Verified speech capabilities; the chat model catalogue deliberately excludes TTS.
export const OPENAI_SPEECH_MODELS = ["gpt-4o-mini-tts", "tts-1", "tts-1-hd"] as const;
const VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer", "verse", "marin", "cedar"];
const LEGACY_VOICES = ["alloy", "ash", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer"];

export interface RemoteSpeech {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** Only advertise known OpenAI capabilities on the official endpoint. */
export function isOpenAiSpeechProvider(provider: ProviderInfo | ProviderSpec): boolean {
  try {
    const url = new URL(provider.baseUrl);
    return url.origin === "https://api.openai.com" && url.pathname.replace(/\/+$/, "") === "/v1"
      && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

export function openAiVoices(model: string) {
  return { engine: "openai", voices: [...(model === "gpt-4o-mini-tts" ? VOICES : LEGACY_VOICES)],
    default: model === "gpt-4o-mini-tts" ? "coral" : "alloy" };
}

export function openAiSpeechError(status: number): string {
  if (status === 401) return "OpenAI speech rejected the API key. Check the provider in Settings → Connections.";
  if (status === 403) return "This OpenAI account cannot use the selected speech model.";
  if (status === 429) return "OpenAI speech reached a rate limit or quota. Check your API billing or try again later.";
  if (status === 400 || status === 404) return "OpenAI could not generate this speech. Check the selected model and voice, or try shorter text.";
  return "OpenAI speech is temporarily unavailable. Try again later.";
}
