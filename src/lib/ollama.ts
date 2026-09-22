import type { AppConfig } from "./config";
import type { Completion, NormalizedToolCall, OllamaChunk, OllamaMessage, OllamaTool, RawToolCall } from "./types";

export class OllamaHttpError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(body || `Ollama returned HTTP ${status}.`);
    this.name = "OllamaHttpError";
    this.status = status;
    this.body = body;
  }
}

export class OllamaConnectionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "OllamaConnectionError";
  }
}

export class UserAbort extends Error {
  constructor() {
    super("aborted");
    this.name = "UserAbort";
  }
}

export function connectionMessage(config: AppConfig): string {
  return `Can't reach Ollama at ${config.ollamaBaseUrl}. Start it with \`ollama serve\`, then run \`ollama pull ${config.ollamaModel}\`. No cloud API key is required.`;
}

export function messageForOllama(error: unknown, config: AppConfig): string {
  if (error instanceof OllamaHttpError) {
    const body = error.body.trim();
    if (error.status === 404 || /not found/i.test(body)) {
      return `The model "${config.ollamaModel}" is not installed. From a terminal, run: ollama pull ${config.ollamaModel}`;
    }
    const short = body.replace(/\s+/g, " ").slice(0, 300);
    return short ? `Ollama returned ${error.status}: ${short}` : `Ollama returned HTTP ${error.status}.`;
  }
  if (error instanceof OllamaConnectionError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong talking to Ollama.";
}

export function toToolCall(name: string, args: Record<string, unknown>): NormalizedToolCall {
  return {
    name,
    arguments: args,
    raw: { function: { name, arguments: args } },
  };
}

export function createAccumulator() {
  let content = "";
  const calls: Array<RawToolCall | undefined> = [];

  return {
    push(chunk: OllamaChunk) {
      if (chunk.message?.content) content += chunk.message.content;
      chunk.message?.tool_calls?.forEach((call, index) => {
        const current = calls[index];
        calls[index] = current ? mergeToolCall(current, call) : call;
      });
    },
    finish(): Completion {
      const toolCalls = calls.flatMap((call) => {
        if (!call) return [];
        const normalized = normalizeToolCall(call);
        return normalized ? [normalized] : [];
      });
      return { content, toolCalls };
    },
  };
}

export function normalizeToolCall(call: RawToolCall): NormalizedToolCall | null {
  const name = call.function?.name?.trim() ?? "";
  if (!name || name.length > 64) return null;
  const args = asRecord(call.function.arguments);
  return {
    name,
    arguments: args,
    raw: { function: { name, arguments: args } },
  };
}

export async function completeWithOllama(input: {
  config: AppConfig;
  messages: OllamaMessage[];
  tools: OllamaTool[];
  onDelta: (text: string) => void;
  signal?: AbortSignal;
}): Promise<Completion> {
  const timeout = AbortSignal.timeout(120_000);
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetch(`${input.config.ollamaBaseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: input.config.ollamaModel,
        messages: input.messages,
        tools: input.tools,
        stream: true,
        think: false,
        options: { temperature: 0.2 },
      }),
      signal,
    });
  } catch (error) {
    throw mapTransportError(error, input);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new OllamaHttpError(response.status, body);
  }
  if (!response.body) {
    throw new OllamaConnectionError("Ollama returned an empty response.");
  }

  const accumulator = createAccumulator();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        consumeLine(line, accumulator, input.onDelta);
      }
    }
    buffer += decoder.decode();
    for (const line of buffer.split("\n")) {
      consumeLine(line, accumulator, input.onDelta);
    }
  } catch (error) {
    throw mapTransportError(error, input);
  }

  return accumulator.finish();
}

function consumeLine(
  line: string,
  accumulator: ReturnType<typeof createAccumulator>,
  onDelta: (text: string) => void,
) {
  const trimmed = line.trim();
  if (!trimmed) return;
  let chunk: OllamaChunk;
  try {
    chunk = JSON.parse(trimmed) as OllamaChunk;
  } catch {
    throw new OllamaConnectionError("Ollama sent a response that was not JSON.");
  }
  if (chunk.error) throw new OllamaHttpError(500, chunk.error);
  if (chunk.message?.content) onDelta(chunk.message.content);
  accumulator.push(chunk);
}

function mapTransportError(error: unknown, input: { config: AppConfig; signal?: AbortSignal }): Error {
  if (input.signal?.aborted) return new UserAbort();
  if (error instanceof UserAbort || error instanceof OllamaHttpError || error instanceof OllamaConnectionError) {
    return error;
  }
  if (error instanceof Error && error.name === "TimeoutError") {
    return new OllamaConnectionError(`Ollama took too long to respond at ${input.config.ollamaBaseUrl}.`);
  }
  if (error instanceof Error && error.name === "AbortError") {
    return input.signal?.aborted
      ? new UserAbort()
      : new OllamaConnectionError(`Ollama took too long to respond at ${input.config.ollamaBaseUrl}.`);
  }
  const code = errorCode(error);
  if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "ECONNRESET") {
    return new OllamaConnectionError(connectionMessage(input.config), { cause: error });
  }
  if (error instanceof TypeError) {
    return new OllamaConnectionError(connectionMessage(input.config), { cause: error });
  }
  return error instanceof Error ? error : new OllamaConnectionError("Something went wrong talking to Ollama.");
}

function errorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

function mergeToolCall(previous: RawToolCall, next: RawToolCall): RawToolCall {
  return {
    function: {
      name: next.function?.name || previous.function?.name || "",
      arguments: mergeArguments(previous.function?.arguments, next.function?.arguments),
    },
  };
}

function mergeArguments(
  previous: RawToolCall["function"]["arguments"] | undefined,
  next: RawToolCall["function"]["arguments"] | undefined,
): RawToolCall["function"]["arguments"] {
  if (typeof next === "string") {
    if (typeof previous === "string") {
      return next.startsWith(previous) ? next : previous + next;
    }
    if (isRecord(previous)) return previous;
    return next;
  }
  if (isRecord(next)) {
    if (isRecord(previous)) return { ...previous, ...next };
    return next;
  }
  if (previous !== undefined) return previous;
  return {};
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  if (isRecord(value)) return value;
  return {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
