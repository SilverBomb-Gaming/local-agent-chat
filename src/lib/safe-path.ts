import fs from "node:fs/promises";
import path from "node:path";

export class PathDenied extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathDenied";
  }
}

/**
 * Resolve a user-supplied path and prove it stays inside the workspace.
 * Symlinks are followed with realpath, then checked again.
 */
export async function resolveWorkspacePath(root: string, userPath: string): Promise<string> {
  if (typeof userPath !== "string") {
    throw new PathDenied("Path must be a string.");
  }
  if (userPath.includes("\0")) {
    throw new PathDenied("Path contains a null byte.");
  }
  if (userPath.length > 512) {
    throw new PathDenied("Path is too long.");
  }

  const rootReal = await realWorkspaceRoot(root);
  const requested = userPath.trim() === "" ? "." : userPath;
  const candidate = path.resolve(rootReal, requested);
  if (!isInside(rootReal, candidate)) {
    throw new PathDenied("That path is outside the workspace.");
  }

  try {
    const real = await fs.realpath(candidate);
    if (!isInside(rootReal, real)) {
      throw new PathDenied("That path is outside the workspace.");
    }
    return real;
  } catch (error) {
    if (error instanceof PathDenied) throw error;
    if (isEnoent(error)) {
      await assertExistingParentsInside(rootReal, candidate);
      return candidate;
    }
    throw error;
  }
}

export async function inspectWorkspace(root: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await realWorkspaceRoot(root);
    return { ok: true };
  } catch (error) {
    if (error instanceof PathDenied) return { ok: false, error: error.message };
    return { ok: false, error: "WORKSPACE_ROOT is not readable." };
  }
}

async function realWorkspaceRoot(root: string): Promise<string> {
  const resolved = path.resolve(root);
  if (resolved === path.parse(resolved).root) {
    throw new PathDenied("WORKSPACE_ROOT cannot be the filesystem root.");
  }
  let real: string;
  try {
    real = await fs.realpath(resolved);
  } catch (error) {
    if (isEnoent(error)) throw new PathDenied("WORKSPACE_ROOT does not exist.");
    throw new PathDenied("WORKSPACE_ROOT is not readable.");
  }
  if (real === path.parse(real).root) {
    throw new PathDenied("WORKSPACE_ROOT cannot be the filesystem root.");
  }
  const stat = await fs.stat(real);
  if (!stat.isDirectory()) {
    throw new PathDenied("WORKSPACE_ROOT is not a directory.");
  }
  return real;
}

async function assertExistingParentsInside(rootReal: string, candidate: string): Promise<void> {
  let current = candidate;
  while (current !== path.dirname(current)) {
    try {
      const real = await fs.realpath(current);
      if (!isInside(rootReal, real)) {
        throw new PathDenied("That path is outside the workspace.");
      }
      return;
    } catch (error) {
      if (error instanceof PathDenied) throw error;
      if (!isEnoent(error)) throw error;
      current = path.dirname(current);
    }
  }
  throw new PathDenied("That path is outside the workspace.");
}

export function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  if (relative === "") return true;
  if (relative === "..") return false;
  if (relative.startsWith(`..${path.sep}`)) return false;
  if (path.isAbsolute(relative)) return false;
  return true;
}

function isEnoent(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
