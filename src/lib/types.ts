export type ClientMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ToolTrace = {
  name: string;
  arguments: Record<string, unknown>;
  ok: boolean;
  snippet: string;
};

export type ServerEvent =
  | { type: "delta"; text: string }
  | ({ type: "tool" } & ToolTrace)
  | { type: "error"; message: string }
  | { type: "done" };

export type OllamaTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
};

export type OllamaMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: RawToolCall[];
  tool_name?: string;
};

export type RawToolCall = {
  function: {
    name: string;
    arguments: Record<string, unknown> | string;
  };
};

export type NormalizedToolCall = {
  name: string;
  arguments: Record<string, unknown>;
  raw: RawToolCall;
};

export type OllamaChunk = {
  error?: string;
  message?: {
    role?: string;
    content?: string;
    thinking?: string;
    tool_calls?: RawToolCall[];
  };
  done?: boolean;
};

export type Completion = {
  content: string;
  toolCalls: NormalizedToolCall[];
};

export type CompleteFn = (input: {
  messages: OllamaMessage[];
  tools: OllamaTool[];
  onDelta: (text: string) => void;
  signal?: AbortSignal;
}) => Promise<Completion>;

export type HealthReport = {
  ok: boolean;
  ollama: boolean;
  model: string;
  modelPresent: boolean;
  workspaceRoot: string;
  workspaceOk: boolean;
  shellEnabled: boolean;
  error?: string;
};
