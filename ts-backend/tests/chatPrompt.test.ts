import assert from "node:assert/strict";
import test from "node:test";
import { buildChatSystemPrompt, todayLabel } from "../src/chatPrompt.js";
import { buildSystemPrompt } from "../src/agent.js";

const base = { name: "Rita", instructions: "", today: "Monday 14 September 2026", homeAssistant: false, entitySummary: "(devices)", search: false };

test("a plain chat prompt is a general assistant with no devices, search, or voice rules", () => {
  const p = buildChatSystemPrompt(base);
  assert.match(p, /You are Rita, a general-purpose AI assistant/);
  assert.match(p, /Monday 14 September 2026/);
  assert.match(p, /markdown/i);
  assert.doesNotMatch(p, /Devices:/);
  assert.doesNotMatch(p, /web_search/);
  assert.doesNotMatch(p, /Instructions from the user/);
  assert.doesNotMatch(p, /speaking with the user out loud/);
  assert.doesNotMatch(p, /one or two sentences/);
});

test("user instructions are included only when non-empty", () => {
  assert.doesNotMatch(buildChatSystemPrompt({ ...base, instructions: "   " }), /Instructions from the user/);
  const p = buildChatSystemPrompt({ ...base, instructions: "Call me Ed. Prefer Python." });
  assert.match(p, /Instructions from the user:\nCall me Ed\. Prefer Python\./);
});

test("search guidance appears when the search tools exist", () => {
  const p = buildChatSystemPrompt({ ...base, search: true });
  assert.match(p, /web_search/);
  assert.match(p, /fetch_page/);
  assert.match(p, /never invent URLs/i);
});

test("the Home Assistant block reuses the voice prompt's device text", () => {
  const p = buildChatSystemPrompt({ ...base, homeAssistant: true });
  assert.match(p, /You control Home Assistant devices with the provided tools/);
  assert.match(p, /Devices:\n\(devices\)/);
  assert.doesNotMatch(p, /You may also answer general questions conversationally/);
  // The voice prompt still carries the sentence and the same device text.
  const voice = buildSystemPrompt("(devices)", "plain", "Rita");
  assert.match(voice, /You may also answer general questions conversationally/);
  assert.match(voice, /Devices:\n\(devices\)/);
});

test("todayLabel formats a readable date", () => {
  assert.equal(todayLabel(new Date(2026, 8, 14, 12)), "Monday 14 September 2026");
});
