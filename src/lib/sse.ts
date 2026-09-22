/** Append a chunk of an SSE body and emit each completed `data:` event. */
export function pushSse(buffer: string, chunk: string, onData: (data: string) => void): string {
  const combined = buffer + chunk;
  const parts = combined.split("\n\n");
  const rest = parts.pop() ?? "";
  for (const part of parts) {
    const data = part
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (data) onData(data);
  }
  return rest;
}

export function encodeSse(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
