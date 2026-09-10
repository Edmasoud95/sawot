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

export class InferenceClient {
  constructor(private baseUrl: string) {}

  async health(): Promise<any> {
    const resp = await fetch(this.baseUrl + "/health");
    return resp.json();
  }

  async transcribe(audio: Buffer, language?: string): Promise<string> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)]), "audio.webm");
    form.append("model", "whisper-1");
    if (language) form.append("language", language);
    const resp = await fetch(this.baseUrl + "/v1/audio/transcriptions", {
      method: "POST",
      body: form,
    });
    if (!resp.ok) await fail(resp, "transcribe");
    const data = await resp.json();
    return data.text ?? "";
  }

  /** Voices the sidecar's active TTS engine offers, with its default. */
  async voices(): Promise<{ engine: string | null; voices: string[]; default: string | null }> {
    const resp = await fetch(this.baseUrl + "/api/voices");
    if (!resp.ok) throw new Error("voices failed: " + resp.status);
    return resp.json();
  }

  async synthesize(text: string, voice?: string): Promise<Buffer> {
    const resp = await fetch(this.baseUrl + "/v1/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: text, voice, response_format: "wav" }),
    });
    if (!resp.ok) await fail(resp, "synthesize");
    return Buffer.from(await resp.arrayBuffer());
  }
}
