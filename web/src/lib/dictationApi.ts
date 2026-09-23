import { API_BASE } from "./config";

export async function transcribeDictation(audio: Blob, signal: AbortSignal): Promise<string> {
  const form = new FormData();
  const extension = audio.type.includes("mp4") ? "mp4" : "webm";
  form.append("file", audio, `dictation.${extension}`);
  form.append("model", "whisper-1");
  const response = await fetch(`${API_BASE}/api/chat/transcribe`, { method: "POST", body: form, signal });
  if (!response.ok) throw new Error("Transcription failed");
  const result = await response.json();
  if (typeof result.text !== "string") throw new Error("Missing transcription");
  return result.text;
}
