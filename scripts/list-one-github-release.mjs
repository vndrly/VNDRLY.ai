import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { githubPatPath } from "./secrets-path.mjs";

// Publication refs are advanced separately through the configured integration.
const token = readFileSync(githubPatPath(), "utf8").trim();
const base = "https://api.github.com/repos/vndrly/VNDRLY.ai";
async function api(path, method = "GET", body) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(`GitHub ${method} ${path}: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}
const [command, argument, extra] = process.argv.slice(2);
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
if (command === "tree") {
  if (!/^[a-f0-9]{40}$/.test(argument ?? "")) throw new Error("Exact base commit required");
  const parent = await api(`/git/commits/${argument}`);
  const paths = git("diff", "--name-only", "--diff-filter=AM", `${argument}..HEAD`).trim().split(/\r?\n/).filter(Boolean);
  if (git("diff", "--name-only", "--diff-filter=DR", `${argument}..HEAD`).trim()) throw new Error("Deletion/rename requires separate review");
  const tree = paths.map(path => ({ path, mode: "100644", type: "blob", content: git("show", `HEAD:${path}`) }));
  const result = await api("/git/trees", "POST", { base_tree: parent.tree.sha, tree });
  const expected = git("rev-parse", "HEAD^{tree}").trim();
  if (result.sha !== expected) throw new Error(`Published object tree differs: ${result.sha} versus ${expected}`);
  console.log(JSON.stringify({ tree: result.sha, parent: argument, files: paths.length }));
} else if (command === "runs") {
  const result = await api(`/actions/runs?per_page=30${argument ? `&head_sha=${encodeURIComponent(argument)}` : ""}`);
  console.log(JSON.stringify(result.workflow_runs.map(({ id, name, status, conclusion, head_sha, html_url }) => ({ id, name, status, conclusion, head_sha, html_url }))));
} else if (command === "jobs") {
  const result = await api(`/actions/runs/${argument}/jobs`);
  console.log(JSON.stringify(result.jobs.map(({ id, name, status, conclusion, steps }) => ({ id, name, status, conclusion, steps }))));
} else if (command === "log") {
  const response = await fetch(`${base}/actions/jobs/${argument}/logs`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Log HTTP ${response.status}`);
  console.log((await response.text()).split("\n").slice(-Number(extra || 160)).join("\n"));
} else if (command === "dispatch") {
  if (!["verify-release.yml", "publish.yml", "deploy-api.yml", "mobile-ota.yml", "mobile-testflight.yml"].includes(argument)) throw new Error("Unsupported release workflow");
  await api(`/actions/workflows/${argument}/dispatches`, "POST", { ref: extra || "main" });
  console.log(JSON.stringify({ dispatched: argument, ref: extra || "main" }));
} else {
  throw new Error("Expected tree, runs, jobs, log, or dispatch");
}
