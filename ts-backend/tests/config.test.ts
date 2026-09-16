import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";

const yaml = `
home_assistant:
  url: "http://yaml.local:8123/"
llm:
  url: "http://localhost:1234/v1/"
  model: "from-yaml"
stt:
  model: "distil-small.en"
tts:
  voice: "af_bella"
server:
  port: 9999
`;

function tmpConfig(): string {
  const dir = mkdtempSync(join(tmpdir(), "sawot-cfg-"));
  const path = join(dir, "config.yaml");
  writeFileSync(path, yaml);
  return path;
}

test("loads yaml with the token from the environment", () => {
  const cfg = loadConfig(tmpConfig(), { HA_TOKEN: "t" });
  assert.equal(cfg.haUrl, "http://yaml.local:8123");
  assert.equal(cfg.llmUrl, "http://localhost:1234/v1");
  assert.equal(cfg.llmModel, "from-yaml");
  assert.equal(cfg.ttsVoice, "af_bella");
  assert.equal(cfg.port, 9999);
});

test("environment overrides yaml keys", () => {
  const cfg = loadConfig(tmpConfig(), { HA_TOKEN: "t", HA_URL: "http://env.local:8123", SERVER_PORT: "8080", ASSISTANT_PERSONALITY: "plain" });
  assert.equal(cfg.haUrl, "http://env.local:8123");
  assert.equal(cfg.llmModel, "from-yaml");
  assert.equal(cfg.port, 8080);
  assert.equal(cfg.assistantPersonality, "plain");
});

test("works from the environment alone when no yaml exists", () => {
  const missing = join(mkdtempSync(join(tmpdir(), "sawot-cfg-")), "config.yaml");
  const cfg = loadConfig(missing, {
    HA_TOKEN: "t", HA_URL: "http://ha.local:8123", LLM_URL: "http://host.docker.internal:1234/v1", SAWOT_DATA_DIR: "/data",
  });
  assert.equal(cfg.haUrl, "http://ha.local:8123");
  assert.equal(cfg.llmUrl, "http://host.docker.internal:1234/v1");
  assert.equal(cfg.llmModel, "");
  assert.equal(cfg.sttModel, "parakeet-unified-en");
  assert.equal(cfg.ttsVoice, "af_heart");
  assert.equal(cfg.host, "0.0.0.0");
  assert.equal(cfg.port, 8765);
  assert.equal(cfg.dataDir, "/data");
});

test("data dir defaults to the config file's directory", () => {
  const path = tmpConfig();
  const cfg = loadConfig(path, { HA_TOKEN: "t" });
  assert.equal(cfg.dataDir, join(path, ".."));
});

test("missing HA_URL and HA_TOKEN are reported by name", () => {
  const missing = join(mkdtempSync(join(tmpdir(), "sawot-cfg-")), "config.yaml");
  assert.throws(() => loadConfig(missing, { HA_TOKEN: "t" }), /HA_URL/);
  assert.throws(() => loadConfig(missing, { HA_URL: "http://ha" }), /HA_TOKEN/);
});

test("the Brave key comes from yaml or the environment and defaults to empty", () => {
  const none = loadConfig(tmpConfig(), { HA_TOKEN: "t" });
  assert.equal(none.braveApiKey, "");
  const fromEnv = loadConfig(tmpConfig(), { HA_TOKEN: "t", BRAVE_API_KEY: "brv-1" });
  assert.equal(fromEnv.braveApiKey, "brv-1");
  const dir = mkdtempSync(join(tmpdir(), "sawot-cfg-"));
  const path = join(dir, "config.yaml");
  writeFileSync(path, yaml + "search:\n  brave_api_key: \"brv-yaml\"\n");
  assert.equal(loadConfig(path, { HA_TOKEN: "t" }).braveApiKey, "brv-yaml");
});

test("WebSocket origins default to deny and can be explicitly configured", () => {
  const path = tmpConfig();
  assert.deepEqual(loadConfig(path, { HA_TOKEN: "t" }).allowedOrigins, []);
  writeFileSync(path, yaml.replace("  port: 9999", '  port: 9999\n  allowed_origins: ["https://voice.example"]'));
  assert.deepEqual(loadConfig(path, { HA_TOKEN: "t" }).allowedOrigins, ["https://voice.example"]);
  assert.deepEqual(loadConfig(path, { HA_TOKEN: "t", SAWOT_ALLOWED_ORIGINS: "https://other.example,http://localhost:5173" }).allowedOrigins,
    ["https://other.example", "http://localhost:5173"]);
  assert.deepEqual(loadConfig(path, { HA_TOKEN: "t", SAWOT_ALLOWED_ORIGINS: "" }).allowedOrigins, []);
});

test("invalid origin configuration fails closed at startup", () => {
  for (const value of ["*", "null", "https://voice.example/path", "https://user:pass@voice.example", "wss://voice.example"]) {
    assert.throws(() => loadConfig(tmpConfig(), { HA_TOKEN: "t", SAWOT_ALLOWED_ORIGINS: value }), /origin/i);
  }
  const path = tmpConfig();
  writeFileSync(path, yaml.replace("  port: 9999", '  port: 9999\n  allowed_origins: "https://voice.example"'));
  assert.throws(() => loadConfig(path, { HA_TOKEN: "t" }), /origin/i);
});
