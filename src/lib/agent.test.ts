import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AppConfig } from "./config";
import { toToolCall } from "./ollama";
import { runAgent } from "./agent";
import { OllamaConnectionError } from "./ollama";
import type { CompleteFn, ServerEvent } from "./types";

async function config(): Promise<AppConfig> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lac-agent-"));
  await fs.writeFile(path.join(root, "welcome.md"), "Hello from the demo folder.");
  return {
    ollamaBaseUrl: "http://127.0.0.1:9",
    ollamaModel: "llama3.2",
    workspaceRoot: root,
    enableShell: false,
    maxReadBytes: 1024,
    maxToolRounds: 4,
  };
}

test("executes list_dir and feeds the result back to the model", async () => {
  const appConfig = await config();
  const events: ServerEvent[] = [];
  let calls = 0;

  const complete: CompleteFn = async ({ messages, tools, onDelta }) => {
    calls += 1;
    assert.equal(tools.some((tool) => tool.function.name === "run_shell"), false);
    if (calls === 1) {
      return { content: "", toolCalls: [toToolCall("list_dir", { path: "." })] };
    }
    const toolMessage = messages.find((message) => message.role === "tool");
    assert.match(toolMessage?.content ?? "", /welcome\.md/);
    onDelta("The workspace has welcome.md.");
    return { content: "The workspace has welcome.md.", toolCalls: [] };
  };

  await runAgent({
    config: appConfig,
    messages: [{ role: "user", content: "List the files in the workspace." }],
    emit: (event) => events.push(event),
    complete,
  });

  const tool = events.find((event) => event.type === "tool");
  assert.equal(tool?.type, "tool");
  if (tool?.type === "tool") {
    assert.equal(tool.ok, true);
    assert.match(tool.snippet, /welcome\.md/);
  }
  assert.ok(events.some((event) => event.type === "delta" && event.text.includes("welcome.md")));
  assert.equal(events.at(-1)?.type, "done");
});

test("shows a denied tool call when the path leaves the workspace", async () => {
  const appConfig = await config();
  const events: ServerEvent[] = [];
  let calls = 0;
  const complete: CompleteFn = async ({ messages, onDelta }) => {
    calls += 1;
    if (calls === 1) {
      return { content: "", toolCalls: [toToolCall("read_file", { path: "/etc/passwd" })] };
    }
    const toolMessage = messages.find((message) => message.role === "tool");
    assert.match(toolMessage?.content ?? "", /outside/);
    onDelta("The tool refused that path.");
    return { content: "The tool refused that path.", toolCalls: [] };
  };

  await runAgent({
    config: appConfig,
    messages: [{ role: "user", content: "Read /etc/passwd" }],
    emit: (event) => events.push(event),
    complete,
  });

  const tool = events.find((event) => event.type === "tool");
  assert.equal(tool?.type, "tool");
  if (tool?.type === "tool") assert.equal(tool.ok, false);
});

test("turns an unreachable Ollama into a clear error", async () => {
  const appConfig = await config();
  const events: ServerEvent[] = [];
  const complete: CompleteFn = async () => {
    throw new OllamaConnectionError("Can't reach Ollama at http://127.0.0.1:9.");
  };
  await runAgent({
    config: appConfig,
    messages: [{ role: "user", content: "Hello" }],
    emit: (event) => events.push(event),
    complete,
  });
  assert.equal(events[0]?.type, "error");
  if (events[0]?.type === "error") assert.match(events[0].message, /Can't reach Ollama/);
  assert.equal(events.at(-1)?.type, "done");
});
