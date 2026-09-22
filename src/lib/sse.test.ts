import assert from "node:assert/strict";
import test from "node:test";
import { encodeSse, pushSse } from "./sse";

test("reassembles events split across chunks", () => {
  const seen: string[] = [];
  const encoded = encodeSse({ type: "delta", text: "Hi" }) + encodeSse({ type: "done" });
  const splitAt = 8;
  let buffer = pushSse("", encoded.slice(0, splitAt), (data) => seen.push(data));
  buffer = pushSse(buffer, encoded.slice(splitAt), (data) => seen.push(data));
  assert.deepEqual(seen, [JSON.stringify({ type: "delta", text: "Hi" }), JSON.stringify({ type: "done" })]);
  assert.equal(buffer, "");
});
