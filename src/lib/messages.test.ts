import assert from "node:assert/strict";
import test from "node:test";
import { ChatInputError, parseClientMessages } from "./messages";

test("keeps user and assistant text and drops empty messages", () => {
  const messages = parseClientMessages([
    { role: "user", content: "  hello  " },
    { role: "assistant", content: "   " },
    { role: "user", content: "list files" },
  ]);
  assert.deepEqual(messages, [
    { role: "user", content: "hello" },
    { role: "user", content: "list files" },
  ]);
});

test("rejects tool roles and a trailing assistant message", () => {
  assert.throws(() => parseClientMessages([{ role: "tool", content: "nope" }]), ChatInputError);
  assert.throws(() => parseClientMessages([{ role: "assistant", content: "hi" }]), /last message/);
});

test("rejects oversized messages", () => {
  assert.throws(() => parseClientMessages([{ role: "user", content: "a".repeat(8001) }]), /8000/);
});
