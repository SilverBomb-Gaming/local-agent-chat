import type { ClientMessage } from "./types";

const MAX_MESSAGES = 32;
const MAX_CHARS = 8_000;

export class ChatInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatInputError";
  }
}

export function parseClientMessages(input: unknown): ClientMessage[] {
  if (!Array.isArray(input)) {
    throw new ChatInputError("Expected a messages array.");
  }
  if (input.length === 0) {
    throw new ChatInputError("Send a message first.");
  }
  if (input.length > MAX_MESSAGES) {
    throw new ChatInputError(`Send at most ${MAX_MESSAGES} messages.`);
  }

  const messages: ClientMessage[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") {
      throw new ChatInputError("Each message must be an object.");
    }
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if (role !== "user" && role !== "assistant") {
      throw new ChatInputError("Messages must be from the user or the assistant.");
    }
    if (typeof content !== "string") {
      throw new ChatInputError("Message content must be a string.");
    }
    const trimmed = content.trim();
    if (!trimmed) continue;
    if (trimmed.length > MAX_CHARS) {
      throw new ChatInputError(`Keep each message under ${MAX_CHARS} characters.`);
    }
    messages.push({ role, content: trimmed });
  }

  if (messages.length === 0 || messages.at(-1)?.role !== "user") {
    throw new ChatInputError("The last message must be from the user.");
  }
  return messages;
}
