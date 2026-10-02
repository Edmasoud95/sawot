import assert from "node:assert/strict";
import test from "node:test";
import { resourceBytes, resourcePercent } from "../src/lib/resources.ts";

test("resource readouts distinguish unsupported counters from zero and retain multicore CPU usage", () => {
  assert.equal(resourceBytes(null), "N/A");
  assert.equal(resourceBytes(0), "0 MiB");
  assert.equal(resourceBytes(2147483648), "2.00 GiB");
  assert.equal(resourcePercent(null), "N/A");
  assert.equal(resourcePercent(0), "0.0%");
  assert.equal(resourcePercent(250), "250.0%");
});
