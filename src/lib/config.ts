import path from "node:path";

export type AppConfig = {
  ollamaBaseUrl: string;
  ollamaModel: string;
  workspaceRoot: string;
  enableShell: boolean;
  maxReadBytes: number;
  maxToolRounds: number;
};

export function getConfig(
  env: Record<string, string | undefined> = process.env,
  cwd = process.cwd(),
): AppConfig {
  return {
    ollamaBaseUrl: parseBaseUrl(env.OLLAMA_BASE_URL),
    ollamaModel: parseModel(env.OLLAMA_MODEL),
    workspaceRoot: path.resolve(cwd, env.WORKSPACE_ROOT?.trim() || "demo-files"),
    enableShell: env.ENABLE_SHELL === "true",
    maxReadBytes: clampInt(env.MAX_READ_BYTES, 32_768, 1_024, 1_000_000),
    maxToolRounds: clampInt(env.MAX_TOOL_ROUNDS, 4, 1, 8),
  };
}

export function parseBaseUrl(value: string | undefined): string {
  const raw = (value ?? "http://127.0.0.1:11434").trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("OLLAMA_BASE_URL is not a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("OLLAMA_BASE_URL must start with http:// or https://.");
  }
  if (url.username || url.password) {
    throw new Error("OLLAMA_BASE_URL must not include credentials.");
  }
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/+$/, "");
}

export function parseModel(value: string | undefined): string {
  const model = (value ?? "llama3.2").trim();
  if (!/^[A-Za-z0-9_.:/-]+$/.test(model) || model.length > 128) {
    throw new Error("OLLAMA_MODEL contains unsupported characters.");
  }
  return model;
}

function clampInt(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}
