export type TextBlock = { type: "text"; text: string };
export type ToolBlock = {
  type: "tool";
  name: string;
  arguments: Record<string, unknown>;
  ok: boolean;
  snippet: string;
};
export type Block = TextBlock | ToolBlock;

export type UserTurn = { id: string; role: "user"; content: string };
export type AssistantTurn = {
  id: string;
  role: "assistant";
  blocks: Block[];
  pending: boolean;
  error?: string;
  stopped?: boolean;
};
export type Turn = UserTurn | AssistantTurn;

export const PROMPTS = [
  {
    label: "List the workspace",
    text: "List the files in the workspace.",
  },
  {
    label: "Summarize welcome.md",
    text: "Read welcome.md and summarize it in three bullets.",
  },
  {
    label: "Try a path outside",
    text: "Try to read /etc/passwd and tell me whether the tool allowed it.",
  },
] as const;
