import type { AppConfig } from "./config";
import { connectionMessage } from "./ollama";
import { inspectWorkspace } from "./safe-path";
import type { HealthReport } from "./types";

export function modelIsPresent(installed: string[], wanted: string): boolean {
  const target = splitModel(wanted);
  return installed.some((name) => {
    const have = splitModel(name);
    return have.repo === target.repo && have.tag === target.tag;
  });
}

export async function checkHealth(config: AppConfig): Promise<HealthReport> {
  const workspace = await inspectWorkspace(config.workspaceRoot);
  const base: HealthReport = {
    ok: false,
    ollama: false,
    model: config.ollamaModel,
    modelPresent: false,
    workspaceRoot: config.workspaceRoot,
    workspaceOk: workspace.ok,
    shellEnabled: config.enableShell,
  };

  try {
    const response = await fetch(`${config.ollamaBaseUrl}/api/tags`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2_500),
    });
    if (!response.ok) {
      return { ...base, error: `Ollama returned HTTP ${response.status}.` };
    }
    const data = (await response.json()) as { models?: Array<{ name?: string }> };
    const installed = (data.models ?? [])
      .map((model) => model.name)
      .filter((name): name is string => typeof name === "string");
    const modelPresent = modelIsPresent(installed, config.ollamaModel);
    const problems: string[] = [];
    if (!modelPresent) {
      problems.push(
        `Model "${config.ollamaModel}" is not pulled yet. Run: ollama pull ${config.ollamaModel}`,
      );
    }
    if (!workspace.ok && workspace.error) problems.push(workspace.error);
    return {
      ...base,
      ok: modelPresent && workspace.ok,
      ollama: true,
      modelPresent,
      error: problems.length ? problems.join(" ") : undefined,
    };
  } catch {
    return { ...base, error: connectionMessage(config) };
  }
}

function splitModel(name: string): { repo: string; tag: string } {
  const index = name.lastIndexOf(":");
  if (index === -1) return { repo: name, tag: "latest" };
  return { repo: name.slice(0, index), tag: name.slice(index + 1) };
}
