import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AppConfig } from "./config";
import { toToolCall } from "./ollama";
import { executeToolCall, toolDefinitions } from "./tools";

async function fixture(): Promise<AppConfig> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lac-tools-"));
  await fs.writeFile(path.join(root, "welcome.md"), "hello workspace");
  await fs.mkdir(path.join(root, "nested"));
  await fs.writeFile(path.join(root, ".env"), "SECRET=1");
  return {
    ollamaBaseUrl: "http://127.0.0.1:11434",
    ollamaModel: "llama3.2",
    workspaceRoot: root,
    enableShell: false,
    maxReadBytes: 32,
    maxToolRounds: 4,
  };
}

test("hides run_shell until it is enabled", async () => {
  const config = await fixture();
  assert.deepEqual(
    toolDefinitions(config).map((tool) => tool.function.name),
    ["list_dir", "read_file"],
  );
  assert.ok(toolDefinitions({ ...config, enableShell: true }).some((tool) => tool.function.name === "run_shell"));
});

test("lists and reads files inside the workspace", async () => {
  const config = await fixture();
  const listed = await executeToolCall(toToolCall("list_dir", { path: "." }), config);
  assert.equal(listed.ok, true);
  assert.match(listed.modelText, /nested\s+dir/);
  assert.match(listed.modelText, /welcome\.md\s+file/);
  assert.ok(listed.modelText.indexOf("nested") < listed.modelText.indexOf("welcome.md"));

  const read = await executeToolCall(toToolCall("read_file", { path: "welcome.md" }), config);
  assert.equal(read.ok, true);
  assert.match(read.modelText, /hello workspace/);
});

test("truncates long text and blocks secrets, binaries, and escapes", async () => {
  const config = await fixture();
  const big = await executeToolCall(toToolCall("read_file", { path: "welcome.md" }), {
    ...config,
    maxReadBytes: 5,
  });
  assert.equal(big.ok, true);
  assert.match(big.modelText, /truncated/);

  const secret = await executeToolCall(toToolCall("read_file", { path: ".env" }), config);
  assert.equal(secret.ok, false);
  assert.match(secret.modelText, /blocked/);

  await fs.writeFile(path.join(config.workspaceRoot, "blob.bin"), Buffer.from([0x00, 0x01, 0x02]));
  const binary = await executeToolCall(toToolCall("read_file", { path: "blob.bin" }), config);
  assert.equal(binary.ok, false);
  assert.match(binary.modelText, /binary/);

  const escape = await executeToolCall(toToolCall("read_file", { path: "/etc/passwd" }), config);
  assert.equal(escape.ok, false);
  assert.match(escape.modelText, /outside/);
});

test("run_shell stays disabled and, when enabled, only echoes or dates", async () => {
  const config = await fixture();
  const disabled = await executeToolCall(toToolCall("run_shell", { command: "date" }), config);
  assert.equal(disabled.ok, false);
  assert.match(disabled.modelText, /disabled/);

  const enabled = { ...config, enableShell: true };
  const injected = await executeToolCall(
    toToolCall("run_shell", { command: "echo", text: "hello; rm -rf /" }),
    enabled,
  );
  assert.equal(injected.ok, true);
  assert.equal(injected.modelText, "hello; rm -rf /");

  const flagged = await executeToolCall(toToolCall("run_shell", { command: "echo", text: "-n still literal" }), enabled);
  assert.equal(flagged.modelText, "-n still literal");

  const date = await executeToolCall(toToolCall("run_shell", { command: "date" }), enabled);
  assert.equal(date.ok, true);
  assert.match(date.modelText, /UTC/);

  const rm = await executeToolCall(toToolCall("run_shell", { command: "rm" }), enabled);
  assert.equal(rm.ok, false);
  assert.match(rm.modelText, /allowlisted/);

  const unknown = await executeToolCall(toToolCall("write_file", { path: "x" }), enabled);
  assert.equal(unknown.ok, false);
  assert.match(unknown.modelText, /not allowlisted/);
});
