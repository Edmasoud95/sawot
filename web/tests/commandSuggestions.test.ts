import assert from "node:assert/strict";
import test from "node:test";
import { commandSuggestions } from "../src/lib/chatCommands.js";

test("slash suggestions filter command prefixes without treating prose as commands", () => {
  assert.deepEqual(commandSuggestions("/").map(c => c.name), ["/status", "/help"]);
  assert.deepEqual(commandSuggestions("/ST").map(c => c.name), ["/status"]);
  assert.deepEqual(commandSuggestions("/help").map(c => c.name), ["/help"]);
  for (const text of ["", "hello", "What does /status mean?", "/status please", "/unknown", "/status\n"]) {
    assert.deepEqual(commandSuggestions(text), []);
  }
});
