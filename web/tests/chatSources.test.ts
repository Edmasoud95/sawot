import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
const require = createRequire(new URL("../package.json", import.meta.url));
const { build } = require("esbuild");
const bundle = await build({ entryPoints: [new URL("../src/chatStore.ts", import.meta.url).pathname], bundle: true, write: false, platform: "node", format: "esm", define: { "import.meta.env": "{}" } });
Object.assign(globalThis, { window: { matchMedia: () => ({ matches: true }) }, location: { protocol: "http:", host: "localhost" }, localStorage: { getItem: () => null } });
const { useChatStore: store } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const search = { tool: "web_search", phase: "complete", sources: [{ url: "https://example.com/", title: "Example", read: false }] };

for (const fails of [false, true]) {
  test(`sources remain visible after ${fails ? "a later model error" : "a completed reply"}`, async () => {
    store.setState({ activeId: "sources", active: { id: "sources", title: "Sources", messages: [] }, conversations: [], streaming: false });
    const events = [
      { type: "search", ...search },
      fails ? { type: "error", message: "Model unavailable" }
        : { type: "done", message: { role: "assistant", content: "Answer", search } },
    ];
    globalThis.fetch = async () => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""));
    await store.getState().startStream("Find sources");
    for (let i = 0; store.getState().streaming && i < 50; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(store.getState().streaming, false);
    assert.deepEqual(store.getState().active.messages.at(-1).search, search);
  });
}
