import type { AppConfig } from "./config";
import { getConfig } from "./config";
import { messageForOllama, completeWithOllama, UserAbort } from "./ollama";
import { executeToolCall, systemPrompt, toolDefinitions } from "./tools";
import type { ClientMessage, CompleteFn, OllamaMessage, ServerEvent } from "./types";

const EMPTY_REPLY =
  "The model returned an empty response. Try a tool-capable model such as llama3.2, llama3.1, or qwen2.5.";

export async function runAgent(options: {
  messages: ClientMessage[];
  emit: (event: ServerEvent) => void;
  signal?: AbortSignal;
  config?: AppConfig;
  complete?: CompleteFn;
}): Promise<void> {
  const config = options.config ?? getConfig();
  const complete =
    options.complete ??
    ((input) =>
      completeWithOllama({
        config,
        messages: input.messages,
        tools: input.tools,
        onDelta: input.onDelta,
        signal: input.signal,
      }));
  const tools = toolDefinitions(config);
  const history: OllamaMessage[] = [
    { role: "system", content: systemPrompt(config) },
    ...options.messages.map((message) => ({ role: message.role, content: message.content })),
  ];

  try {
    for (let round = 0; round <= config.maxToolRounds; round += 1) {
      if (options.signal?.aborted) return;
      const allowTools = round < config.maxToolRounds;
      const result = await complete({
        messages: history,
        tools: allowTools ? tools : [],
        onDelta: (text) => options.emit({ type: "delta", text }),
        signal: options.signal,
      });

      if (result.toolCalls.length === 0 || !allowTools) {
        if (!result.content.trim()) {
          if (!allowTools && result.toolCalls.length > 0) {
            options.emit({
              type: "delta",
              text: "Stopped after the tool-call limit for this demo.",
            });
          } else {
            options.emit({ type: "error", message: EMPTY_REPLY });
          }
        }
        options.emit({ type: "done" });
        return;
      }

      history.push({
        role: "assistant",
        content: result.content,
        tool_calls: result.toolCalls.map((call) => call.raw),
      });

      for (const call of result.toolCalls) {
        if (options.signal?.aborted) return;
        const execution = await executeToolCall(call, config);
        options.emit({
          type: "tool",
          name: call.name,
          arguments: call.arguments,
          ok: execution.ok,
          snippet: execution.snippet,
        });
        history.push({
          role: "tool",
          tool_name: call.name,
          content: execution.modelText,
        });
      }
    }
  } catch (error) {
    if (error instanceof UserAbort || options.signal?.aborted) return;
    options.emit({ type: "error", message: messageForOllama(error, config) });
    options.emit({ type: "done" });
  }
}
