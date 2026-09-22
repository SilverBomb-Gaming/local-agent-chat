import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { getConfig } from "./config";

test("defaults point at local Ollama and demo-files", () => {
  const config = getConfig({}, "/work/app");
  assert.equal(config.ollamaBaseUrl, "http://127.0.0.1:11434");
  assert.equal(config.ollamaModel, "llama3.2");
  assert.equal(config.workspaceRoot, path.resolve("/work/app", "demo-files"));
  assert.equal(config.enableShell, false);
  assert.equal(config.maxReadBytes, 32_768);
});

test("shell stays off unless the flag is exactly true", () => {
  assert.equal(getConfig({ ENABLE_SHELL: "true" }, "/work").enableShell, true);
  assert.equal(getConfig({ ENABLE_SHELL: "TRUE" }, "/work").enableShell, false);
  assert.equal(getConfig({ ENABLE_SHELL: "1" }, "/work").enableShell, false);
});

test("rejects credentials and non-http base URLs", () => {
  assert.throws(() => getConfig({ OLLAMA_BASE_URL: "http://user:pass@127.0.0.1:11434" }), /credentials/);
  assert.throws(() => getConfig({ OLLAMA_BASE_URL: "file:///tmp/ollama" }), /http/);
});

test("clamps the read limit", () => {
  assert.equal(getConfig({ MAX_READ_BYTES: "10" }, "/work").maxReadBytes, 1024);
  assert.equal(getConfig({ MAX_READ_BYTES: "999999999" }, "/work").maxReadBytes, 1_000_000);
});
