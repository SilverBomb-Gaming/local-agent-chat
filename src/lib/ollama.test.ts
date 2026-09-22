import assert from "node:assert/strict";
import test from "node:test";
import { createAccumulator } from "./ollama";

test("joins streamed text and keeps one tool call", () => {
  const accumulator = createAccumulator();
  accumulator.push({ message: { content: "Hel" } });
  accumulator.push({
    message: {
      content: "lo",
      tool_calls: [{ function: { name: "list_dir", arguments: { path: "." } } }],
    },
  });
  accumulator.push({
    message: {
      tool_calls: [{ function: { name: "list_dir", arguments: { path: "." } } }],
    },
    done: true,
  });
  const result = accumulator.finish();
  assert.equal(result.content, "Hello");
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0]?.name, "list_dir");
  assert.deepEqual(result.toolCalls[0]?.arguments, { path: "." });
});

test("parses tool arguments that arrive as JSON text", () => {
  const accumulator = createAccumulator();
  accumulator.push({
    message: {
      tool_calls: [{ function: { name: "read_file", arguments: '{"path":' } }],
    },
  });
  accumulator.push({
    message: {
      tool_calls: [{ function: { name: "read_file", arguments: '"welcome.md"}' } }],
    },
  });
  const result = accumulator.finish();
  assert.deepEqual(result.toolCalls[0]?.arguments, { path: "welcome.md" });
});
