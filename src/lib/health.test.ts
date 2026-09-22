import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AppConfig } from "./config";
import { checkHealth, modelIsPresent } from "./health";

test("matches a model tag without confusing other tags", () => {
  const installed = ["llama3.2:latest", "llama3.2:1b", "qwen2.5:7b"];
  assert.equal(modelIsPresent(installed, "llama3.2"), true);
  assert.equal(modelIsPresent(installed, "llama3.2:1b"), true);
  assert.equal(modelIsPresent(installed, "llama3.1"), false);
  assert.equal(modelIsPresent(installed, "qwen2.5:7b"), true);
});

test("reports Ollama offline without throwing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lac-health-"));
  const config: AppConfig = {
    ollamaBaseUrl: "http://127.0.0.1:9",
    ollamaModel: "llama3.2",
    workspaceRoot: root,
    enableShell: false,
    maxReadBytes: 1024,
    maxToolRounds: 4,
  };
  const report = await checkHealth(config);
  assert.equal(report.ollama, false);
  assert.equal(report.ok, false);
  assert.equal(report.workspaceOk, true);
  assert.match(report.error ?? "", /Can't reach Ollama/);
});
