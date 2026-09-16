// OpenAI's model list only guarantees an ID, not capability information.
// Keep unknown local/custom names, but omit known dedicated non-chat families.
// Match purpose tokens rather than substrings so names like "vision" stay usable.
const NON_CHAT_PURPOSE = /(?:^|[/:._-])(?:embeddings?|embed|rerank(?:er)?|moderation|whisper|tts|stt|transcribe|transcription|realtime)(?=$|[/:._-])/i;
const NON_CHAT_FAMILY = /(?:^|\/)(?:gpt-image|chatgpt-image|dall-e|sora|flux|stable-diffusion|sdxl|qwen-image|imagen|veo|kokoro|chatterbox|bge|e5)(?=$|[.:_-])/i;
const GPT_AUDIO = /(?:^|\/)gpt-(?:[^/]*-)?audio(?=$|[._-])/i;
const LEGACY_COMPLETION = /(?:^|[/:])(?:(?:text-)?(?:ada|babbage|curie|davinci)(?=$|[-:])|gpt-3\.5-turbo-instruct(?:-|$))/i;

function hasText(modalities: unknown): boolean | undefined {
  if (!Array.isArray(modalities)) return undefined;
  return modalities.some((modality) => modality === "text");
}

/** Models usable for text conversation in both the voice assistant and chat.
 * OpenRouter-style modality metadata rules out incompatible inputs/outputs;
 * known model-family names cover catalogues without that metadata.
 * Image input is allowed: vision-capable language models still belong here.
 */
export function chatModelIds(models: unknown[]): string[] {
  const ids = new Set<string>();
  for (const entry of models) {
    if (!entry || typeof entry !== "object") continue;
    const model = entry as { id?: unknown; architecture?: { input_modalities?: unknown; output_modalities?: unknown; modality?: unknown } };
    if (typeof model.id !== "string" || !model.id.trim()) continue;
    const architecture = model.architecture;
    if (hasText(architecture?.input_modalities) === false || hasText(architecture?.output_modalities) === false) continue;
    if (typeof architecture?.modality === "string" && architecture.modality.includes("->")) {
      const [input, output] = architecture.modality.split("->");
      if (!input.split("+").includes("text") || !output.split("+").includes("text")) continue;
    }
    if (NON_CHAT_PURPOSE.test(model.id) || NON_CHAT_FAMILY.test(model.id) || GPT_AUDIO.test(model.id) || LEGACY_COMPLETION.test(model.id)) continue;
    ids.add(model.id);
  }
  return [...ids];
}
