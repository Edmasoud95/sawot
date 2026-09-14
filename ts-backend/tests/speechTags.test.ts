import assert from "node:assert/strict";
import test from "node:test";
import { CHATTERBOX_TAGS, speechTagPrompt, stripSpeechTags, forSpeech, supportsSpeechTags } from "../src/speechTags.js";
import { Agent } from "../src/agent.js";

test("only Chatterbox engines get the tag guidance in the prompt", () => {
  assert.equal(speechTagPrompt("kokoro"), "");
  assert.equal(speechTagPrompt("some-other-engine"), "");
  assert.equal(speechTagPrompt(null), "");
  for (const engine of ["chatterbox-turbo", "chatterbox-nano"]) {
    const prompt = speechTagPrompt(engine);
    assert.ok(supportsSpeechTags(engine));
    for (const tag of CHATTERBOX_TAGS) assert.ok(prompt.includes(tag), `${engine} prompt lists ${tag}`);
    assert.match(prompt, /sparingly/i);
    for (const inert of ["[whispering]", "[dramatic]", "[angry]"]) assert.ok(!prompt.includes(inert), `${inert} does nothing on Turbo and is not suggested`);
  }
  assert.equal(CHATTERBOX_TAGS.length, 9);
});

test("tags are stripped from captions and history but kept for a Chatterbox voice", () => {
  const raw = "[chuckle] Fine, the light is off. [sigh] Next time do it yourself.";
  assert.equal(stripSpeechTags(raw), "Fine, the light is off. Next time do it yourself.");
  assert.equal(stripSpeechTags("Done [laugh]."), "Done.");
  assert.equal(stripSpeechTags("[whispering]Shh, it's late."), "Shh, it's late.");
  assert.equal(stripSpeechTags("The [red] button, in [brackets]."), "The [red] button, in [brackets].", "unknown brackets are ordinary text");
  assert.equal(forSpeech(raw, "chatterbox-nano"), raw);
  assert.equal(forSpeech("[dramatic] Every light blazed red. [whispering] We've been waiting. [gasp] Oh.", "chatterbox-turbo"),
    "Every light blazed red. We've been waiting. [gasp] Oh.", "inert style tags are dropped even for Chatterbox");
  assert.equal(forSpeech(raw, "kokoro"), stripSpeechTags(raw), "other engines would read the tags aloud");
  assert.equal(forSpeech(raw, null), stripSpeechTags(raw));
});

function agentWith(turns: any[], captured: any[] = []) {
  let i = 0;
  const client = { chat: { completions: { create: async (req: any) => { captured.push(req); return { choices: [{ message: turns[i++] }] }; } } } };
  return new Agent(client as never, "test", [], "Assistant");
}

test("the agent tells the model about tags for a Chatterbox voice and keeps them out of history", async () => {
  const captured: any[] = [];
  const history: any[] = [];
  const reply = await agentWith([{ role: "assistant", content: "[laugh] Sure thing." }], captured)
    .run(history, "hi", undefined, { expressions: true, speechEngine: "chatterbox-nano" });
  assert.match(captured[0].messages[0].content, /\[laugh\]/);
  assert.equal(reply, "[laugh] Sure thing.", "the spoken reply keeps the tag for the engine");
  assert.equal(history.at(-1).content, "Sure thing.", "the tag never re-enters the conversation as text");

  const plain: any[] = [];
  await agentWith([{ role: "assistant", content: "Hi" }], plain).run([], "hi", undefined, { expressions: true, speechEngine: "kokoro" });
  assert.doesNotMatch(plain[0].messages[0].content, /\[laugh\]/);
  const chat: any[] = [];
  await agentWith([{ role: "assistant", content: "Hi" }], chat).run([], "hi", undefined, {});
  assert.doesNotMatch(chat[0].messages[0].content, /\[laugh\]/, "chat mode never speaks, so it never sees the tags");
});

test("a voice turn captions the plain text and speaks the tagged text on Chatterbox", async () => {
  const { runVoiceTurn } = await import("../src/pipeline.js");
  for (const [engine, expectSpoken] of [["chatterbox-turbo", "[chuckle] Light's off."], ["kokoro", "Light's off."]] as const) {
    const events: any[] = [];
    const spoken: string[] = [];
    const inference = {
      transcribe: async () => "lights off",
      voices: async () => ({ engine, voices: [], default: null }),
      synthesize: async (text: string) => { spoken.push(text); return Buffer.from("wav"); },
    };
    await runVoiceTurn(inference as never, agentWith([{ role: "assistant", content: "[chuckle] Light's off." }]), Buffer.from("audio"), [], (type, data) => { events.push({ type, ...data }); }, "test");
    assert.equal(events.find((e) => e.type === "assistant_text").text, "Light's off.", `${engine}: caption is plain`);
    assert.deepEqual(spoken, [expectSpoken], `${engine}: spoken text`);
  }
});
