import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveWorkspacePath } from "./safe-path";

async function makeRoot() {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "lac-path-"));
  const root = path.join(parent, "workspace");
  await fs.mkdir(root);
  return { parent, root };
}

test("reads a file inside the workspace", async () => {
  const { root } = await makeRoot();
  await fs.writeFile(path.join(root, "welcome.md"), "hello");
  const resolved = await resolveWorkspacePath(root, "welcome.md");
  assert.equal(resolved, path.join(root, "welcome.md"));
});

test("rejects parent traversal, absolute paths, and prefix siblings", async () => {
  const { parent, root } = await makeRoot();
  const evil = path.join(parent, "workspace-evil");
  await fs.mkdir(evil);
  await fs.writeFile(path.join(evil, "secret.txt"), "nope");
  await fs.writeFile(path.join(parent, "secret.txt"), "nope");

  await assert.rejects(() => resolveWorkspacePath(root, "../secret.txt"), /outside/);
  await assert.rejects(() => resolveWorkspacePath(root, "../../etc/passwd"), /outside/);
  await assert.rejects(() => resolveWorkspacePath(root, "/etc/passwd"), /outside/);
  await assert.rejects(() => resolveWorkspacePath(root, path.join(evil, "secret.txt")), /outside/);
});

test("rejects a symlink that points outside the workspace", async () => {
  const { parent, root } = await makeRoot();
  const outside = path.join(parent, "outside");
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "secret.txt"), "nope");
  await fs.symlink(outside, path.join(root, "escape"));

  await assert.rejects(() => resolveWorkspacePath(root, "escape"), /outside/);
  await assert.rejects(() => resolveWorkspacePath(root, "escape/secret.txt"), /outside/);
});

test("allows a symlink whose target stays inside the workspace", async () => {
  const { root } = await makeRoot();
  const target = path.join(root, "notes.txt");
  await fs.writeFile(target, "hi");
  await fs.symlink(target, path.join(root, "alias.txt"));
  const resolved = await resolveWorkspacePath(root, "alias.txt");
  assert.equal(resolved, target);
});

test("refuses the filesystem root as a workspace", async () => {
  await assert.rejects(() => resolveWorkspacePath(path.parse(process.cwd()).root, "etc"), /filesystem root/);
});
