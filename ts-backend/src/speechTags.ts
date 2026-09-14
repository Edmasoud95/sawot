// Inline performance tags for TTS engines that understand them. Only the
// Chatterbox family does today: these 19 tags are tokens in its tokenizer.
// Any other engine would read a tag aloud as words, so the model is told
// about them only when a Chatterbox model is the active voice, and captions
// and history always get the plain text.

const SOUND_TAGS = ["[laugh]", "[chuckle]", "[sigh]", "[gasp]", "[groan]", "[cough]", "[sniff]", "[clear throat]", "[shush]"];
const STYLE_TAGS = ["[happy]", "[angry]", "[sarcastic]", "[surprised]", "[fear]", "[crying]", "[dramatic]", "[whispering]", "[narration]", "[advertisement]"];

export const CHATTERBOX_TAGS: readonly string[] = [...SOUND_TAGS, ...STYLE_TAGS];

const TAG_PATTERN = new RegExp(
  "\\s*(?:" + CHATTERBOX_TAGS.map((t) => t.replace(/[[\]]/g, "\\$&")).join("|") + ")\\s*",
  "gi",
);

export function supportsSpeechTags(engine: string | null | undefined): boolean {
  return typeof engine === "string" && engine.startsWith("chatterbox-");
}

/** System prompt paragraph for the active voice, or nothing. */
export function speechTagPrompt(engine: string | null | undefined): string {
  if (!supportsSpeechTags(engine)) return "";
  return "\n\nYour voice can perform inline tags written in square brackets. " +
    "Sounds, placed where they happen: " + SOUND_TAGS.join(", ") + ". " +
    "Delivery styles, placed at the start of the sentence they colour: " + STYLE_TAGS.join(", ") + ". " +
    "Use them sparingly, at most one or two per reply and only when the moment genuinely calls for it; most replies need none. " +
    "Only these exact tags work, and they are never shown as text.";
}

/** The plain text for captions and conversation history. */
export function stripSpeechTags(text: string): string {
  return text
    .replace(TAG_PATTERN, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** What to send to the synthesiser: tags only for an engine that speaks them. */
export function forSpeech(text: string, engine: string | null | undefined): string {
  return supportsSpeechTags(engine) ? text : stripSpeechTags(text);
}
