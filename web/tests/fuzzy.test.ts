import assert from "node:assert/strict";
import test from "node:test";
import { fuzzyMatch, rankModels } from "../src/lib/fuzzy.ts";

test("subsequence matches score higher for contiguous and word-start hits, and fail when letters are missing", () => {
  assert.equal(fuzzyMatch("xyz", "qwen3-8b"), null);
  const exact = fuzzyMatch("qwen3", "qwen3-8b")!, spread = fuzzyMatch("qn8", "qwen3-8b")!;
  assert.ok(exact.score > spread.score, "contiguous beats scattered");
  assert.deepEqual(exact.indices, [0, 1, 2, 3, 4]);
  const wordStart = fuzzyMatch("dv", "deepseek-v4")!, midWord = fuzzyMatch("ev", "deepseek-v4")!;
  assert.ok(wordStart.score > midWord.score, "hits at word starts rank first");
  assert.ok(fuzzyMatch("QWEN", "qwen3-8b"), "matching ignores case");
  assert.deepEqual(fuzzyMatch("", "anything")!.indices, []);
});

test("rankModels keeps provider groups, orders matches by score, and drops providers with no hits", () => {
  const providers = [
    { id: "local", name: "Local server", models: ["google/gemma-4-e4b", "qwen/qwen3.8-27b"], state: "ready" },
    { id: "deepseek", name: "DeepSeek", models: ["deepseek-v4-flash", "deepseek-chat"], state: "ready" },
    { id: "glm", name: "glm", models: [], state: "pending" },
  ];
  const all = rankModels("", providers);
  assert.deepEqual(all.map((g) => g.id), ["local", "deepseek", "glm"], "an empty query lists everything, pending groups included");
  assert.equal(all[2].items.length, 0);
  const q = rankModels("flash", providers);
  assert.deepEqual(q.map((g) => g.id), ["deepseek", "glm"], "groups without hits drop, pending groups stay so the user knows they are loading");
  assert.deepEqual(q[0].items.map((i) => i.model), ["deepseek-v4-flash"]);
  const gem = rankModels("gemma", providers);
  assert.equal(gem[0].items[0].model, "google/gemma-4-e4b");
  assert.equal(gem[0].items[0].value, "local::google/gemma-4-e4b");
  const both = rankModels("ds", providers)[0].items.map((i) => i.model);
  assert.equal(both.length, 2);
});
