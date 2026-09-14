// Inline sound tags for TTS engines that perform them. Only the Chatterbox
// family does today. Any other engine would read a tag aloud as words, so
// the model is told about them only when a Chatterbox model is the active
// voice, and captions and history always get the plain text.

/** Tags Chatterbox Turbo and Nano actually perform: a sound at that point. */
export const CHATTERBOX_TAGS: readonly string[] = ["[laugh]", "[chuckle]", "[sigh]", "[gasp]", "[groan]", "[cough]", "[sniff]", "[clear throat]", "[shush]"];

// Style tags also sit in Chatterbox's vocabulary, but measured on Turbo they
// change nothing audible ([whispering], [dramatic] and [angry] came out at
// the baseline loudness and spectrum). They are never suggested and are
// removed everywhere so a model that emits one cannot leave it in the text.
const INERT_TAGS = ["[happy]", "[angry]", "[sarcastic]", "[surprised]", "[fear]", "[crying]", "[dramatic]", "[whispering]", "[narration]", "[advertisement]"];

const pattern = (tags: readonly string[]) => new RegExp(
  "\\s*(?:" + tags.map((t) => t.replace(/[[\]]/g, "\\$&")).join("|") + ")\\s*",
  "gi",
);
const ALL_TAGS = pattern([...CHATTERBOX_TAGS, ...INERT_TAGS]);
const INERT_ONLY = pattern(INERT_TAGS);

export function supportsSpeechTags(engine: string | null | undefined): boolean {
  return typeof engine === "string" && engine.startsWith("chatterbox-");
}

/** System prompt paragraph for the active voice, or nothing. */
export function speechTagPrompt(engine: string | null | undefined): string {
  if (!supportsSpeechTags(engine)) return "";
  return "\n\nYour voice can perform inline sound tags written in square brackets, placed exactly where the sound happens: " +
    CHATTERBOX_TAGS.join(", ") + ". " +
    "Use them sparingly, at most one or two per reply and only when the moment genuinely calls for it; most replies need none. " +
    "Only these exact tags work: there are no tags for mood, tone, whispering or delivery, so express those through the words themselves. " +
    "Tags are never shown as text.";
}

function tidy(text: string): string {
  return text.replace(/\s+([.,!?;:])/g, "$1").replace(/\s{2,}/g, " ").trim();
}

/** The plain text for captions and conversation history. */
export function stripSpeechTags(text: string): string {
  return tidy(text.replace(ALL_TAGS, " "));
}

/** What to send to the synthesiser: the performed tags for an engine that
 *  speaks them, plain text for any other. */
export function forSpeech(text: string, engine: string | null | undefined): string {
  return supportsSpeechTags(engine) ? tidy(text.replace(INERT_ONLY, " ")) : stripSpeechTags(text);
}
