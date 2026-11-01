import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { previewCheckout } from "../local-preview-checkout.mjs";

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "vndrly-preview-test-"));
  t.after(() => {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith("vndrly-preview-test-"));
    rmSync(root, { recursive: true, force: true });
  });
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "main");
  git("config", "user.email", "preview-test@example.invalid");
  git("config", "user.name", "Preview test");
  writeFileSync(path.join(root, "app.txt"), "old"); git("add", "."); git("commit", "-m", "old");
  const old = git("rev-parse", "HEAD");
  writeFileSync(path.join(root, "app.txt"), "shipped"); git("commit", "-am", "shipped");
  const shipped = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/main", shipped);
  writeFileSync(path.join(root, ".git", "local-preview.json"), JSON.stringify({ checkout: root, releaseCommit: shipped }));
  return { root, git, old, shipped };
}

test("accepts the published checkout", t => {
  const f = fixture(t);
  assert.equal(previewCheckout(f.root).commit, f.shipped);
});
test("rejects the exact stale-checkout regression", t => {
  const f = fixture(t); f.git("checkout", "--detach", f.old);
  assert.throws(() => previewCheckout(f.root), /behind or diverges/);
});
test("a stale worktree resolves to the selected main checkout", t => {
  const f = fixture(t);
  const worktree = path.join(f.root, "other");
  f.git("worktree", "add", "--detach", worktree, f.old);
  assert.equal(previewCheckout(worktree).commit, f.shipped);
  assert.equal(previewCheckout(worktree).root.toLowerCase(), f.root.toLowerCase());
});
test("a later published release invalidates the older local selection", t => {
  const f = fixture(t);
  writeFileSync(path.join(f.root, "app.txt"), "next"); f.git("commit", "-am", "next");
  f.git("update-ref", "refs/remotes/origin/main", "HEAD");
  f.git("checkout", "--detach", f.shipped);
  assert.throws(() => previewCheckout(f.root), /behind or diverges/);
});
