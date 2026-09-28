import assert from "node:assert/strict";
import test from "node:test";
import { effortLevels, lmStudioEffortLevels } from "../src/effort.js";

test("DeepSeek uses advertised levels and official endpoint fallback", () => {
  assert.deepEqual(effortLevels("https://api.deepseek.com/v1", "deepseek-flash", { effort: { supported_levels: ["low", "high", "max"] } }), ["none", "low", "high", "max"]);
  assert.deepEqual(effortLevels("https://api.deepseek.com", "deepseek-v4-pro"), ["none", "low", "high", "max"]);
  assert.deepEqual(effortLevels("https://api.deepseek.com", "future", { effort: { supported_levels: ["low", "high"] } }), ["none", "low", "high"]);
  assert.deepEqual(effortLevels("https://api.deepseek.com", "deepseek-flash", { effort: { supported_levels: [] } }), []);
  assert.deepEqual(effortLevels("https://api.deepseek.com", "deepseek-flash", { supported_reasoning_efforts: [] }), []);
  assert.deepEqual(effortLevels("https://proxy.example/v1", "deepseek-flash"), []);
  assert.deepEqual(effortLevels("https://api.deepseek.com", "deepseek-unknown"), []);
});

test("LM Studio uses native grades, maps off to none and omits on aliases", () => {
  assert.deepEqual(lmStudioEffortLevels({ capabilities: { reasoning: { allowed_options: ["off", "low", "medium", "xhigh", "on"] } } }), ["none", "low", "medium", "xhigh"]);
  assert.deepEqual(lmStudioEffortLevels({ capabilities: { reasoning: { allowed_options: ["low", "medium", "high"] } } }), ["low", "medium", "high"]);
  for (const allowed_options of [["off", "on"], ["on"], [], "high"]) assert.deepEqual(lmStudioEffortLevels({ capabilities: { reasoning: { allowed_options } } }), []);
  assert.deepEqual(lmStudioEffortLevels({ capabilities: { reasoning: true } }), []);
});
