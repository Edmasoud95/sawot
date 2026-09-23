import assert from "node:assert/strict";
import test from "node:test";
import { BrowserDictationRecorder } from "../src/lib/dictationRecorder.ts";

Object.assign(globalThis, { requestAnimationFrame: () => 1, cancelAnimationFrame: () => {} });

test("microphone permission arriving after cancellation releases its tracks", async () => {
  let grant!: (stream: any) => void;
  let stopped = 0;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: { getUserMedia: () => new Promise(resolve => { grant = resolve; }) } } });
  const recorder = new BrowserDictationRecorder(() => {}, () => assert.fail("unexpected error"));
  const starting = recorder.start();
  recorder.cancel();
  grant({getTracks: () => [{stop: () => { stopped++; }}]});
  await starting;
  assert.equal(stopped,1);
});

test("unsupported recording releases the microphone instead of leaking it", async () => {
  let stopped = 0;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: { getUserMedia: async () => ({getTracks: () => [{stop: () => { stopped++; }}]}) } } });
  Object.assign(globalThis,{MediaRecorder:class { static isTypeSupported() {return false;} constructor() {throw new Error("unsupported");} }});
  const recorder = new BrowserDictationRecorder(() => {}, () => {});
  await assert.rejects(recorder.start(),/unsupported/);
  assert.ok(stopped >= 1);
});
