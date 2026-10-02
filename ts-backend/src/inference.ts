/** A failed sidecar call, carrying the sidecar's own explanation when it gave
 *  one (for example "model not downloaded yet"). */
export class InferenceError extends Error {
  constructor(public readonly status: number, public readonly detail: string | null, what: string) {
    super(`${what} failed: ${status}${detail ? " — " + detail : ""}`);
  }
}

async function fail(resp: Response, what: string): Promise<never> {
  let detail: string | null = null;
  try {
    const body: any = await resp.json();
    if (typeof body?.detail === "string") detail = body.detail;
  } catch { /* not JSON */ }
  throw new InferenceError(resp.status, detail, what);
}

import { OPENAI_SPEECH_MODELS, openAiVoices, openAiSpeechError, type RemoteSpeech } from "./openaiSpeech.js";

export class InferenceClient {
  constructor(private baseUrl: string, private getSpeech: () => RemoteSpeech | undefined = () => undefined) {}

  /** Keep provider, credentials and model consistent throughout a voice turn. */
  snapshot(): InferenceClient {
    const selected = this.getSpeech();
    const speech = selected ? { ...selected } : undefined;
    return new InferenceClient(this.baseUrl, () => speech);
  }

  async health(): Promise<any> {
    const resp = await fetch(this.baseUrl + "/health");
    return resp.json();
  }

  async transcribe(audio: Buffer, language?: string, signal?: AbortSignal): Promise<string> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)]), "audio.webm");
    form.append("model", "whisper-1");
    if (language) form.append("language", language);
    const resp = await fetch(this.baseUrl + "/v1/audio/transcriptions", {
      method: "POST",
      signal,
      body: form,
    });
    if (!resp.ok) await fail(resp, "transcribe");
    const data = await resp.json();
    return data.text ?? "";
  }

  /** Voices the sidecar's active TTS engine offers, with its default. */
  async voices(signal?: AbortSignal): Promise<{ engine: string | null; voices: string[]; default: string | null }> {
    const speech = this.getSpeech();
    if (speech) return openAiVoices(speech.model);
    const resp = await fetch(this.baseUrl + "/api/voices", { signal });
    if (!resp.ok) throw new Error("voices failed: " + resp.status);
    return resp.json();
  }

  async synthesize(text: string, voice?: string, signal?: AbortSignal): Promise<Buffer> {
    const speech = this.getSpeech();
    if (speech) return this.synthesizeOpenAi(speech, text, voice, signal);
    const resp = await fetch(this.baseUrl + "/v1/audio/speech", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: text, voice, response_format: "wav" }),
    });
    if (!resp.ok) await fail(resp, "synthesize");
    return Buffer.from(await resp.arrayBuffer());
  }

  private async synthesizeOpenAi(speech: RemoteSpeech, text: string, voice?: string, signal?: AbortSignal): Promise<Buffer> {
    signal?.throwIfAborted();
    if (!speech.apiKey) throw new InferenceError(401, "Set an OpenAI API key in Settings → Connections before using speech.", "synthesize");
    if (!(OPENAI_SPEECH_MODELS as readonly string[]).includes(speech.model)) {
      throw new InferenceError(400, "Select a supported OpenAI speech model in Settings → Speech.", "synthesize");
    }
    const catalogue = openAiVoices(speech.model);
    const selectedVoice = voice ?? catalogue.default;
    if (!catalogue.voices.includes(selectedVoice)) throw new InferenceError(400, "Select a supported OpenAI voice in Settings → Speech.", "synthesize");
    if (!text.trim() || text.length > 4096) throw new InferenceError(400, "OpenAI speech needs between 1 and 4096 characters. Try shorter text.", "synthesize");
    const timeout = AbortSignal.timeout(60_000);
    try {
      const resp = await fetch(speech.baseUrl.replace(/\/+$/, "") + "/audio/speech", {
        method: "POST",
        redirect: "error",
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + speech.apiKey },
        body: JSON.stringify({ model: speech.model, input: text, voice: selectedVoice, response_format: "wav" }),
      });
      if (!resp.ok) {
        await resp.body?.cancel();
        throw new InferenceError(resp.status, openAiSpeechError(resp.status), "synthesize");
      }
      return Buffer.from(await resp.arrayBuffer());
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof InferenceError) throw error;
      throw new InferenceError(502, timeout.aborted ? "OpenAI speech timed out. Try again." : "Couldn't reach OpenAI speech. Check your connection and try again.", "synthesize");
    }
  }
}
