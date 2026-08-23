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
    if (!resp.ok) throw new Error("transcribe failed: " + resp.status);
    const data = await resp.json();
    return data.text ?? "";
  }

  async synthesize(text: string, voice?: string): Promise<Buffer> {
    const resp = await fetch(this.baseUrl + "/v1/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: text, voice, response_format: "wav" }),
    });
    if (!resp.ok) throw new Error("synthesize failed: " + resp.status);
    return Buffer.from(await resp.arrayBuffer());
  }
}
