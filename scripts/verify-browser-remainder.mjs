import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
export const BASELINE_SHA="d041f6f6f98a6f1099f6f48e7812daaae763b281";
export const REPO="vndrly/VNDRLY.ai";
export const ALLOWED=[".github/workflows/verify-browser-remainder.yml","scripts/verify-browser-remainder.mjs","scripts/tests/verify-browser-remainder.test.mjs",".github/workflows/verify-release.yml"];
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const git=(...args)=>execFileSync("git",args,{cwd:ROOT,encoding:"utf8",maxBuffer:32*1024*1024});
export function cleanLog(text){return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g,"").replace(/^[^\r\n\t]*\t[^\r\n\t]*\t(?=\d{4}-\d\d-\d\dT)/gm,"").replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z\s?/gm,"");}
function identity(line){return line.trim().replace(/\s+\([\d.]+(?:ms|s|m|h)\)$/,"").replace(/\\/g,"/");}
export function parsePassed(log){
  const clean=cleanLog(log);
  if (/^\s*[✘×]\s+\d+\s+\[chromium\]/m.test(clean)||/^\s*\d+ failed\s*$/m.test(clean))throw new Error("Baseline contains browser failures");
  return [...clean.matchAll(/^\s*[✓✔]\s+\d+\s+(\[chromium\]\s+›\s+.+)$/gm)].map(m=>identity(m[1]));
}
export function parseSkipped(log){return [...cleanLog(log).matchAll(/^\s*-\s+\d+\s+(\[chromium\]\s+›\s+.+)$/gm)].map(m=>identity(m[1]));}
export function parseListed(log){return [...cleanLog(log).matchAll(/^\s*(\[chromium\]\s+›\s+.+)$/gm)].map(m=>identity(m[1]).replace(/^(\[chromium\] › )(?!tests\/)([^/]+\.spec\.ts:)/, "$1tests/$2"));}
export function validateDiff(paths,oldWorkflow,newWorkflow){
  if(paths.some(p=>!ALLOWED.includes(p)))throw new Error("Application tree changed; complete verification required");
  if(oldWorkflow.replace(/\r\n/g,"\n").replace("timeout-minutes: 35","timeout-minutes: 45")!==newWorkflow.replace(/\r\n/g,"\n"))throw new Error("Original verification gates changed beyond the demonstrated timeout correction");
}
export function validateBaseline(run,jobs,log,branch){
  if(run.status!=="completed"||run.head_sha!==BASELINE_SHA||run.repository?.full_name!==REPO||run.head_repository?.full_name!==REPO||run.head_branch!==branch||!branch.startsWith("codex/")||run.path!==".github/workflows/verify-release.yml"||!["cancelled","timed_out"].includes(run.conclusion))throw new Error("Baseline provenance or timeout status invalid");
  const job=jobs.find(j=>j.name==="verify");if(!job||job.status!=="completed"||!["cancelled","timed_out"].includes(job.conclusion))throw new Error("Baseline job not interrupted");
  const required=["Typecheck and locale parity","Independent database-backed API gate","Rehearse first application and replay of guarded Work Hub migrations","Verify fresh test database safety invariants"];
  if(required.some(name=>!job.steps.some(s=>s.name===name&&s.status==="completed"&&s.conclusion==="success")))throw new Error("A required baseline gate did not pass");
  if(!job.steps.some(s=>s.name==="Full required test chain"&&s.conclusion==="cancelled"))throw new Error("Full chain was not interrupted");
  const clean=cleanLog(log);
  if(!/^>\s+workspace@\S+\s+test:e2e\s/m.test(clean)||!clean.includes("Running 50 tests using 1 worker"))throw new Error("Baseline did not reach the final browser chain");
  const passed=parsePassed(log);if(passed.length!==47||new Set(passed).size!==47)throw new Error("Expected exactly 47 unique baseline browser successes");
  const skipped=parseSkipped(log);if(skipped.length!==1||skipped[0]!=="[chromium] › tests/fleet-production-offline.spec.ts:12:1 › production Fleet boots offline, captures a new ticket and photo, then reconciles once after a lost response")throw new Error("Expected exactly the configured production-offline browser skip");
  return {jobId:job.id,passed,skipped,covered:[...passed,...skipped],requiredGates:required};
}
export function remainingTests(covered,listed){
  if(listed.length!==50||new Set(listed).size!==50||covered.length!==48||new Set(covered).size!==48||covered.some(p=>!listed.includes(p)))throw new Error("Browser coverage does not match the immutable baseline");
  const remaining=listed.filter(t=>!covered.includes(t));
  if(remaining.length!==2||!/^\[chromium\] › tests\/work-hub-audio\.spec\.ts:25:\d+ › /.test(remaining[0])||!/^\[chromium\] › tests\/work-hub-workspace\.spec\.ts:51:\d+ › /.test(remaining[1]))throw new Error("Remainder is not the two interrupted Work Hub cases");
  return remaining;
}
function immutableTree(){
  const paths=git("diff","--name-only",BASELINE_SHA,"HEAD").trim().split(/\r?\n/).filter(Boolean);
  validateDiff(paths,git("show",`${BASELINE_SHA}:.github/workflows/verify-release.yml`),readFileSync(resolve(ROOT,".github/workflows/verify-release.yml"),"utf8"));
  const scripts=JSON.parse(git("show",`${BASELINE_SHA}:package.json`)).scripts;
  if(scripts.test!=="pnpm run test:libs && pnpm run test:web && pnpm run test:mobile && pnpm run test:api && pnpm run test:e2e")throw new Error("Unexpected baseline chain");
  return {paths,head:git("rev-parse","HEAD").trim(),tree:git("rev-parse","HEAD^{tree}").trim()};
}
async function api(path,text=false){
  const token=process.env.GITHUB_TOKEN;if(!token)throw new Error("Read-only Actions token required");
  const r=await fetch(`https://api.github.com/repos/${REPO}${path}`,{headers:{Authorization:`Bearer ${token}`,Accept:"application/vnd.github+json"},signal:AbortSignal.timeout(120000)});
  if(!r.ok)throw new Error(`Actions evidence unavailable (${r.status})`);return text?r.text():r.json();
}
async function prepare(runId,folder){
  if(!/^\d+$/.test(runId||""))throw new Error("Baseline run ID required");mkdirSync(folder,{recursive:true});
  const tree=immutableTree();const run=await api(`/actions/runs/${runId}`),jobs=(await api(`/actions/runs/${runId}/jobs?per_page=100`)).jobs;
  const job=jobs.find(j=>j.name==="verify");if(!job)throw new Error("Baseline verify job missing");
  const log=await api(`/actions/jobs/${job.id}/logs`,true);writeFileSync(resolve(folder,"baseline.log"),log);
  const proof=validateBaseline(run,jobs,log,process.env.GITHUB_REF_NAME||git("branch","--show-current").trim());
  writeFileSync(resolve(folder,"proof.json"),JSON.stringify({baselineRunId:runId,baselineSha:BASELINE_SHA,repository:REPO,...tree,...proof},null,2));
  console.log("Validated immutable application tree, 47 prior browser passes and one configured skip; two browser cases remain.");
}
function playwright(args){
  const result=spawnSync("corepack",["pnpm","--dir",ROOT,"--filter","@workspace/e2e","exec","playwright","test",...args],{cwd:ROOT,env:process.env,encoding:"utf8",maxBuffer:32*1024*1024});
  return {output:(result.stdout||"")+(result.stderr||""),status:result.status,error:result.error};
}
function runRemainder(folder){
  const proof=JSON.parse(readFileSync(resolve(folder,"proof.json"),"utf8")),tree=immutableTree();if(proof.head!==tree.head||proof.tree!==tree.tree)throw new Error("Prepared tree changed");
  if(process.env.VNDRLY_TEST_DB_MODE!=="fresh-local"||process.env.VNDRLY_ISOLATED_TEST_DB!=="1")throw new Error("Fresh isolated database wrapper required");
  const list=playwright(["--list"]);writeFileSync(resolve(folder,"listed.log"),list.output);if(list.status!==0||list.error)throw new Error("Browser test inventory failed");
  const remaining=remainingTests(proof.covered,parseListed(list.output));
  const result=playwright(["tests/work-hub-audio.spec.ts","tests/work-hub-workspace.spec.ts"]);writeFileSync(resolve(folder,"remainder.log"),result.output);console.log(result.output);
  if(result.status!==0||result.error)throw new Error("Interrupted browser cases failed");
  const passed=parsePassed(result.output);if(passed.length!==2||passed.some((identity,index)=>identity!==remaining[index]))throw new Error("Remainder success did not cover the exact missing identities");
  writeFileSync(resolve(folder,"proof.json"),JSON.stringify({...proof,remaining,completed:passed,coverage:{baselinePasses:47,baselineSkipped:1,continuation:2,total:50},verifiedAt:new Date().toISOString()},null,2));
  console.log("All 50 browser identities now have successful evidence against the unchanged application tree.");
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [mode,a,b]=process.argv.slice(2);
  if(mode==="prepare")await prepare(a,resolve(b));else if(mode==="run")runRemainder(resolve(a));else throw new Error("Use prepare <baseline_run_id> <proof_directory> or run <proof_directory>");
}
