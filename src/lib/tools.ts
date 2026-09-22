import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "./config";
import { PathDenied, resolveWorkspacePath } from "./safe-path";
import type { NormalizedToolCall, OllamaTool } from "./types";
const LIST_LIMIT = 200;
const SNIPPET_CHARS = 800;
const ECHO_CHARS = 400;
const HARD_READ_CAP = 5 * 1024 * 1024;
const BLOCKED_NAME = /^(?:\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx))$/i;

export type ToolExecution = {
  ok: boolean;
  modelText: string;
  snippet: string;
};

/**
 * Read-only workspace tools, plus an optional two-command shell.
 * Every path is resolved against WORKSPACE_ROOT before it is used.
 * run_shell is not advertised unless ENABLE_SHELL=true, and even then
 * it execs a fixed argv: /bin/date -u, or /usr/bin/printf with format %s
 * and the echo text as one argument.
 */
export function toolDefinitions(config: AppConfig): OllamaTool[] {
  const tools: OllamaTool[] = [
    {
      type: "function",
      function: {
        name: "list_dir",
        description:
          "List files and folders directly inside a workspace directory. Does not recurse. The path is relative to the workspace root; use \".\" for the root.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Relative directory path. Defaults to the workspace root.",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "read_file",
        description:
          "Read a UTF-8 text file inside the workspace. The path is relative to the workspace root. Refuses paths outside the workspace, binary files, secret filenames, and files over the size limit.",
        parameters: {
          type: "object",
          required: ["path"],
          properties: {
            path: {
              type: "string",
              description: "Relative file path, for example welcome.md",
            },
          },
        },
      },
    },
  ];

  if (config.enableShell) {
    tools.push({
      type: "function",
      function: {
        name: "run_shell",
        description:
          "Run one allowlisted command and nothing else: \"date\" prints UTC time, \"echo\" prints the provided text literally. No pipes, no shell operators, no other programs.",
        parameters: {
          type: "object",
          required: ["command"],
          properties: {
            command: { type: "string", enum: ["date", "echo"] },
            text: { type: "string", description: "Literal text for echo. Ignored by date." },
          },
        },
      },
    });
  }

  return tools;
}

export function systemPrompt(config: AppConfig): string {
  const names = toolDefinitions(config)
    .map((tool) => tool.function.name)
    .join(", ");
  return [
    "You are a local assistant in a demo called local-agent-chat.",
    "You run against Ollama on the user's machine. You do not have internet access.",
    `You may use only these tools: ${names}.`,
    "Paths are relative to the workspace root. Do not guess file contents; call read_file.",
    "If a tool returns an error, say what went wrong in plain language.",
    "Do not claim you ran a tool you did not call.",
    "Keep answers short enough to skim.",
  ].join(" ");
}

export async function executeToolCall(call: NormalizedToolCall, config: AppConfig): Promise<ToolExecution> {
  try {
    switch (call.name) {
      case "list_dir":
        return await listDir(call.arguments, config);
      case "read_file":
        return await readFileTool(call.arguments, config);
      case "run_shell":
        return await runShell(call.arguments, config);
      default:
        return fail(`Tool "${call.name}" is not allowlisted.`);
    }
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (error instanceof PathDenied) return fail(error.message);
    if (code === "ENOENT") return fail("No file or folder at that path.");
    if (code === "EACCES" || code === "EPERM") return fail("Permission denied for that path.");
    console.error("Tool failed", call.name, error);
    return fail("Tool failed.");
  }
}

async function listDir(args: Record<string, unknown>, config: AppConfig): Promise<ToolExecution> {
  if (args.path !== undefined && typeof args.path !== "string") {
    return fail("path must be a string.");
  }
  const requested = typeof args.path === "string" ? args.path : ".";
  const resolved = await resolveWorkspacePath(config.workspaceRoot, requested);
  const stat = await fs.lstat(resolved);
  if (!stat.isDirectory()) return fail("That path is not a directory.");

  const entries = await fs.readdir(resolved, { withFileTypes: true });
  entries.sort((a, b) => {
    const rank = (entry: (typeof entries)[number]) => (entry.isDirectory() ? 0 : 1);
    const byKind = rank(a) - rank(b);
    if (byKind !== 0) return byKind;
    return a.name.localeCompare(b.name);
  });

  const shown = entries.slice(0, LIST_LIMIT);
  const lines = await Promise.all(
    shown.map(async (entry) => {
      const kind = entry.isSymbolicLink() ? "symlink" : entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other";
      if (!entry.isFile()) return `${entry.name}  ${kind}`;
      try {
        const fileStat = await fs.lstat(path.join(resolved, entry.name));
        return `${entry.name}  ${kind}  ${fileStat.size} B`;
      } catch {
        return `${entry.name}  ${kind}`;
      }
    }),
  );
  const extra =
    entries.length > shown.length ? `\n… ${entries.length - shown.length} more entries not shown` : "";
  const body = (lines.join("\n") + extra).trim() || "(empty directory)";
  return ok(body);
}

async function readFileTool(args: Record<string, unknown>, config: AppConfig): Promise<ToolExecution> {
  if (typeof args.path !== "string" || args.path.trim() === "") {
    return fail("path is required and must be a string.");
  }
  if (BLOCKED_NAME.test(path.basename(args.path))) {
    return fail("That filename is blocked. Secrets and keys are not readable.");
  }
  const resolved = await resolveWorkspacePath(config.workspaceRoot, args.path);
  if (BLOCKED_NAME.test(path.basename(resolved))) {
    return fail("That filename is blocked. Secrets and keys are not readable.");
  }
  const stat = await fs.lstat(resolved);
  if (!stat.isFile()) return fail("That path is not a file.");
  if (stat.size > HARD_READ_CAP) {
    return fail(`File is ${stat.size} bytes, over the ${HARD_READ_CAP} byte hard cap.`);
  }

  const data = await fs.readFile(resolved);
  if (data.includes(0)) return fail("That file looks binary. This tool only reads text.");

  const truncated = data.byteLength > config.maxReadBytes;
  const slice = truncated ? data.subarray(0, config.maxReadBytes) : data;
  let text = slice.toString("utf8");
  if (truncated) text += `\n\n[truncated to ${config.maxReadBytes} bytes]`;
  return ok(text);
}

async function runShell(args: Record<string, unknown>, config: AppConfig): Promise<ToolExecution> {
  if (!config.enableShell) {
    return fail("run_shell is disabled. Set ENABLE_SHELL=true to allow date and echo only.");
  }
  if (args.command !== "date" && args.command !== "echo") {
    return fail("Only date and echo are allowlisted. Nothing else will run.");
  }
  if (process.platform === "win32") {
    return fail("run_shell in this demo runs on macOS and Linux.");
  }

  try {
    if (args.command === "date") {
      const stdout = await execText("/bin/date", ["-u"]);
      return ok(stdout.trim());
    }
    if (typeof args.text !== "string") return fail("echo requires a text string.");
    if (args.text.length > ECHO_CHARS) return fail(`echo text is limited to ${ECHO_CHARS} characters.`);
    // printf %s keeps the text literal, including leading dashes. /bin/echo would treat those as flags.
    const stdout = await execText("/usr/bin/printf", ["%s", args.text]);
    return ok(stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : "Command failed.";
    return fail(message.slice(0, 300));
  }
}

function execText(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 3_000, maxBuffer: 8_192, encoding: "utf8" }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

function ok(modelText: string): ToolExecution {
  return { ok: true, modelText, snippet: clip(modelText) };
}

function fail(message: string): ToolExecution {
  return { ok: false, modelText: message, snippet: clip(message) };
}

export function clip(text: string, max = SNIPPET_CHARS): string {
  const clean = text.replaceAll("\u0000", "");
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max)}\n…`;
}
