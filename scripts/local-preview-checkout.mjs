import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();

// A machine-local selection shared by all worktrees. Never change Git history here.
export function previewCheckout(repoRoot) {
  const common = path.resolve(repoRoot, git(repoRoot, "rev-parse", "--git-common-dir"));
  const configFile = path.join(common, "local-preview.json");
  const config = existsSync(configFile) ? JSON.parse(readFileSync(configFile, "utf8")) : {};
  const root = realpathSync(config.checkout ?? repoRoot);
  const commit = git(root, "rev-parse", "HEAD");
  const required = config.releaseCommit ?? git(root, "rev-parse", "refs/remotes/origin/main");
  for (const baseline of [required, git(root, "rev-parse", "refs/remotes/origin/main")]) {
    try { git(root, "merge-base", "--is-ancestor", baseline, commit); }
    catch { throw new Error(`Local preview stopped: ${root} is behind or diverges from published release ${baseline}. Update the main checkout before restarting.`); }
  }
  return { root, commit };
}

const entry = process.argv[1] && path.resolve(process.argv[1]);
const moduleFile = fileURLToPath(import.meta.url);
if (entry && ["run-api-local.mjs", "run-vite-local.mjs", "run-expo-local.mjs"].includes(path.basename(entry))) {
  const current = realpathSync(path.resolve(path.dirname(moduleFile), ".."));
  const target = previewCheckout(current);
  console.log(`[local-preview] ${target.root} @ ${target.commit}`);
  if (current.toLowerCase() !== target.root.toLowerCase()) {
    const result = spawnSync(process.execPath, [path.join(target.root, "scripts", path.basename(entry)), ...process.argv.slice(2)], { cwd: target.root, stdio: "inherit", windowsHide: true });
    if (result.error) throw result.error;
    process.exit(result.status ?? 1);
  }
} else if (entry === moduleFile) {
  console.log(JSON.stringify(previewCheckout(path.resolve(path.dirname(moduleFile), ".."))));
}
