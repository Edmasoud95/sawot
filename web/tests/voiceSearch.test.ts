import assert from "node:assert/strict";
import test from "node:test";
Object.defineProperty(globalThis, "localStorage", { value: { getItem: () => null, setItem: () => {} } });
const { useVoiceStore } = await import("../src/store.ts");
const source = { url: "https://example.com/article", title: "Article", read: false };

test("sources accumulate across searches, deduplicate pages and preserve Read status", () => {
  const s = useVoiceStore.getState();
  assert.equal(typeof s.showSearch, "function", "store must consume product search events");
  s.clearCaptions();
  s.showSearch({ tool: "web_search", phase: "complete", sources: [source] });
  s.showSearch({ tool: "fetch_page", phase: "complete", sources: [{ ...source, read: true }] });
  s.showSearch({ tool: "web_search", phase: "start" });
  assert.equal(useVoiceStore.getState().search.sources[0].read, true);
  s.showSearch({ tool: "web_search", phase: "complete", sources: [source, { ...source, url: "https://other.example/" }] });
  assert.equal(useVoiceStore.getState().search.sources.length, 2);
  assert.equal(useVoiceStore.getState().search.sources[0].read, true);
  s.showSearch({ tool: "fetch_page", phase: "error", sources: [] });
  assert.equal(useVoiceStore.getState().search.phase, "error");
  assert.equal(useVoiceStore.getState().search.sources.length, 2);
});

test("source state clears on disconnect and caption reset, and stays through playback", () => {
  const s = useVoiceStore.getState();
  assert.equal(typeof s.showSearch, "function");
  s.clearCaptions();
  for (const status of ["connecting"]) {
    s.showSearch({ tool: "web_search", phase: "complete", sources: [source] });
    s.setStatus("speaking");
    s.setStatus("idle");
    assert.equal(useVoiceStore.getState().search.sources.length, 1);
    s.setStatus(status);
    assert.equal(useVoiceStore.getState().search, null);
  }
  s.showSearch({ tool: "web_search", phase: "start" });
  s.clearCaptions();
  assert.equal(useVoiceStore.getState().search, null);
});

test("source links reject unsafe schemes and credentials without losing valid pages", () => {
  const s = useVoiceStore.getState();
  s.clearCaptions();
  s.showSearch({ tool: "web_search", phase: "complete", sources: [
    source,
    { ...source, url: "javascript:alert(1)" },
    { ...source, url: "https://user:secret@example.com/" },
    { ...source, url: "not a URL" },
  ] });
  assert.deepEqual(useVoiceStore.getState().search.sources, [source]);
  s.clearSearch();
  assert.equal(useVoiceStore.getState().search, null);
});

test("reading a page preserves its favicon and filters untrusted image URLs", () => {
  const s = useVoiceStore.getState();
  const favicon = "https://imgs.search.brave.com/test-icon";
  s.clearCaptions();
  s.showSearch({ tool: "web_search", phase: "complete", sources: [{ ...source, favicon }] });
  s.showSearch({ tool: "fetch_page", phase: "complete", sources: [{ ...source, read: true }] });
  assert.equal(useVoiceStore.getState().search.sources[0].favicon, favicon);
  s.showSearch({ tool: "web_search", phase: "complete", sources: [{ ...source, url: "https://other.example/", favicon: "https://untrusted.example/icon" }] });
  assert.equal(useVoiceStore.getState().search.sources[1].favicon, undefined);
});

test("a failed follow-up keeps successful sources in the collapsed row", async () => {
  const { voiceSearchStatus } = await import("../src/lib/voiceSearch.ts");
  assert.equal(typeof voiceSearchStatus, "function");
  const view = voiceSearchStatus({ tool: "web_search", phase: "error", sources: [source] });
  assert.equal(view.showSources, true);
  assert.match(view.status, /additional search failed/i);
  assert.doesNotMatch(view.status, /unavailable/i);
  const empty = voiceSearchStatus({ tool: "web_search", phase: "error", sources: [] });
  assert.equal(empty.showSources, false);
  assert.match(empty.status, /search failed/i);
});

test("find_in_page uses the existing source row and retains favicon metadata", async () => {
  const { voiceSearchStatus } = await import("../src/lib/voiceSearch.ts");
  const s = useVoiceStore.getState();
  s.clearCaptions();
  const favicon = "https://imgs.search.brave.com/test-icon";
  s.showSearch({ tool: "web_search", phase: "complete", sources: [{ ...source, favicon }] });
  s.showSearch({ tool: "find_in_page", phase: "start" });
  assert.equal(useVoiceStore.getState().search?.tool, "find_in_page");
  assert.match(voiceSearchStatus(useVoiceStore.getState().search).status, /page/i);
  s.showSearch({ tool: "find_in_page", phase: "complete", sources: [{ ...source, read: true }] });
  assert.equal(useVoiceStore.getState().search.sources[0].read, true);
  assert.equal(useVoiceStore.getState().search.sources[0].favicon, favicon);
});

for (const withSearch of [false, true]) {
  test(`previous answer sources persist until replacement (new search: ${withSearch})`, () => {
    const s = useVoiceStore.getState();
    s.clearCaptions();
    s.showSearch({ tool: "web_search", phase: "complete", sources: [source] });
    s.setAssistantCaption("Previous answer");
    for (const status of ["speaking", "starting", "listening", "recording", "thinking"]) {
      s.setStatus(status);
      assert.deepEqual(useVoiceStore.getState().search?.sources, [source]);
    }
    s.beginResponse();
    const next = { ...source, url: "https://next.example/" };
    if (withSearch) {
      s.showSearch({ tool: "web_search", phase: "start" });
      s.showSearch({ tool: "web_search", phase: "complete", sources: [next] });
    }
    assert.equal(useVoiceStore.getState().assistantCaption, "Previous answer");
    assert.deepEqual(useVoiceStore.getState().search?.sources, [source]);
    s.setAssistantCaption("Next answer");
    assert.equal(useVoiceStore.getState().assistantCaption, "Next answer");
    assert.deepEqual(useVoiceStore.getState().search?.sources ?? [], withSearch ? [next] : []);
  });
}

test("interrupted searches do not leak into the next answer", () => {
  const s = useVoiceStore.getState();
  s.clearCaptions();
  s.showSearch({ tool: "web_search", phase: "complete", sources: [source] });
  s.setAssistantCaption("Previous answer");
  s.beginResponse();
  s.showSearch({ tool: "web_search", phase: "complete", sources: [{ ...source, url: "https://cancelled.example/" }] });
  s.beginResponse();
  s.setAssistantCaption("Answer without search");
  assert.equal(useVoiceStore.getState().search, null);
});
