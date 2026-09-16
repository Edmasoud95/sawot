import assert from "node:assert/strict";
import test from "node:test";
import { chatModelIds } from "../src/chatModels.js";

test("chat pickers omit dedicated non-chat models from a mixed provider catalogue", () => {
  const chat = ["gpt-4.1", "gpt-4o", "o3", "gpt-5-codex", "openai/gpt-4o-mini", "Qwen/Qwen2.5-VL-7B-Instruct", "my-local-model"];
  const other = ["text-embedding-3-small", "text-embedding-ada-002", "omni-moderation-latest", "whisper-1", "tts-1-hd", "gpt-4o-mini-tts", "gpt-4o-transcribe", "gpt-4o-transcribe-diarize", "gpt-realtime", "gpt-4o-realtime-preview", "gpt-audio", "gpt-4o-audio-preview", "dall-e-3", "gpt-image-1", "chatgpt-image-latest", "sora-2", "nomic-embed-text", "BAAI/bge-m3", "intfloat/e5-large-v2", "rerank-v3.5", "black-forest-labs/FLUX.1-schnell", "Qwen/Qwen-Image", "stabilityai/stable-diffusion-xl-base-1.0"];
  assert.deepEqual(chatModelIds([...chat, ...other].map(id => ({ id }))), chat);
});

test("modality metadata excludes non-text models without hiding vision chat", () => {
  assert.deepEqual(chatModelIds([
    { id: "custom-image", architecture: { input_modalities: ["text"], output_modalities: ["image"] } },
    { id: "custom-audio", architecture: { output_modalities: ["audio"] } },
    { id: "vision-chat", architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] } },
    { id: "image-captioner", architecture: { input_modalities: ["image"], output_modalities: ["text"] } },
    { id: "multimodal-chat", architecture: { modality: "text+image->text" } },
    { id: "video-generator", architecture: { modality: "text->video" } },
  ]), ["vision-chat", "multimodal-chat"]);
});

test("model lists keep order, remove duplicates and tolerate malformed entries", () => {
  assert.deepEqual(chatModelIds([null, {}, { id: 12 }, { id: "" }, { id: " " }, { id: "local-chat" }, { id: "local-chat" }]), ["local-chat"]);
});

test("completion-only legacy models are omitted while fine-tuned chat models remain", () => {
  assert.deepEqual(chatModelIds(["davinci-002", "babbage-002", "text-davinci-003", "gpt-3.5-turbo-instruct", "ft:davinci-002:example", "ft:gpt-4o-mini:example"].map(id => ({ id }))), ["ft:gpt-4o-mini:example"]);
});
