import assert from "node:assert/strict";
import test from "node:test";
import { rankModels } from "../src/lib/fuzzy.ts";
import { parseModelFavorites } from "../src/lib/modelFavorites.ts";
const providers = [{ id: "a", name: "First", models: ["shared", "other"] }, { id: "b", name: "Second", models: ["shared"] }];
test("favorites are provider-qualified, first, unique and still searchable", () => {
  const groups = rankModels("", providers, ["b::shared", "missing::model"]);
  assert.equal(groups[0].name, "Favorites");
  assert.deepEqual(groups[0].items.map(m => [m.value, m.providerName]), [["b::shared", "Second"]]);
  assert.equal(groups.flatMap(g => g.items).filter(m => m.value === "b::shared").length, 1);
  assert.ok(groups.flatMap(g => g.items).some(m => m.value === "a::shared"));
  assert.equal(rankModels("other", providers, ["b::shared"])[0].name, "First");
  assert.equal(rankModels("shared", providers, ["b::shared"])[0].name, "Favorites");
  assert.deepEqual(rankModels("", providers, []), rankModels("", providers));
});
test("favorite storage handles invalid and duplicate values", () => {
  for (const raw of [null, "broken", "{}", '"model"']) assert.deepEqual(parseModelFavorites(raw), []);
  assert.deepEqual(parseModelFavorites('["a::model",42,null,"a::model","unqualified"]'), ["a::model"]);
});
