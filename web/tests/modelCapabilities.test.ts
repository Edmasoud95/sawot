import assert from "node:assert/strict";
import test from "node:test";
import { modelImageInput, firstImageModel } from "../src/lib/modelCapabilities.ts";

test("image support stays provider-specific and unknown metadata stays unknown", () => {
  const providers = [
    { id: "local", name: "Local", builtin: true, state: "ready", models: ["plain", "vision-name"], imageInput: { plain: false } },
    { id: "cloud", name: "Cloud", state: "ready", models: ["plain"], imageInput: { plain: true } },
  ];
  assert.equal(modelImageInput("plain", providers), false);
  assert.equal(modelImageInput("cloud::plain", providers), true);
  assert.equal(modelImageInput("local::vision-name", providers), undefined);
  assert.equal(modelImageInput("missing::plain", providers), undefined);
  assert.equal(firstImageModel(providers), "cloud::plain");
  assert.equal(firstImageModel([{ ...providers[1], state: "error" }]), undefined);
  assert.equal(modelImageInput("cloud::plain", [{ ...providers[1], state: "pending" }]), undefined);
});
