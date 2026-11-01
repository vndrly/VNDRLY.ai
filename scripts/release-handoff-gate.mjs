import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

export const TRACKS = ['commit', 'push', 'web', 'api', 'supabase', 'ota', 'testflight', 'plugin', 'local_sync'];
const text = value => typeof value === 'string' && value.trim().length > 0;
const timestamp = value => text(value) && Number.isFinite(Date.parse(value));
const strings = value => Array.isArray(value) && value.length > 0 && value.every(text);

export function checkHandoff(state, mode) {
  const errors = [];
  if (!['complete', 'blocked'].includes(mode)) errors.push('Mode must be complete or blocked.');
  if (!state || typeof state !== 'object') return [...errors, 'Missing release ledger.'];
  const auth = state.authorization;
  const scope = auth?.scope;
  if (!Array.isArray(scope) || scope.length !== TRACKS.length
      || new Set(scope).size !== TRACKS.length
      || TRACKS.some(id => !scope.includes(id))) {
    errors.push('Full ship scope must contain exactly all nine manifest tracks, without additions, omissions, or duplicates.');
  }
  for (const id of Object.keys(state.tracks ?? {})) {
    if (!TRACKS.includes(id)) errors.push(`${id}: not a full-ship manifest track; do not add substitute requirements.`);
  }
  if (!text(auth?.instruction) || !strings(auth?.scope) || !strings(auth?.restrictions)
      || !strings(auth?.completionCriteria) || !timestamp(auth?.requestedAt)) {
    errors.push('Preserve the original authorization, scope, restrictions, criteria, and request time.');
  }
  if (auth?.deadline !== null && !timestamp(auth?.deadline)) errors.push('Deadline must be an ISO timestamp or null.');
  if (!/^[a-f0-9]{40}$/i.test(state.releaseCommit ?? '')) errors.push('Missing exact release commit.');
  if (!timestamp(state.updatedAt)) errors.push('Missing checkpoint update time.');
  if (!Array.isArray(state.activeJobs) || state.activeJobs.length) errors.push('Inspect and finish active jobs before a voluntary handoff.');
  const evidence = items => Array.isArray(items) && items.length > 0 && items.every(item =>
    text(item?.source) && timestamp(item?.observedAt) && item.commit === state.releaseCommit && text(item?.result));
  let blocked = 0;
  for (const id of TRACKS) {
    const track = state.tracks?.[id];
    if (!track) { errors.push(`${id}: missing track.`); continue; }
    if (typeof track.canProceed !== 'boolean') errors.push(`${id}: explicitly record whether work can proceed.`);
    if (track.canProceed) errors.push(`${id}: runnable work remains.`);
    if (!text(track.nextAction)) errors.push(`${id}: missing next action or completed outcome.`);
    if (track.status === 'verified') {
      if (!evidence(track.evidence)) errors.push(`${id}: missing verification evidence for this release.`);
      if (id === 'local_sync') errors.push(...checkLocalSync(track.verification, state.releaseCommit));
    } else if (track.status === 'blocked') {
      blocked++;
      if (mode === 'complete') errors.push(`${id}: blocked is not complete.`);
      const blocker = track.blocker;
      if (!text(blocker?.reason) || !evidence(blocker?.attempts)
          || !strings(blocker?.alternativesConsidered) || !text(blocker?.requiredExternalChange)) {
        errors.push(`${id}: document the boundary, attempted evidence, alternatives, and required external change.`);
      }
    } else errors.push(`${id}: ${track.status ?? 'unknown'} work remains; continue execution.`);
  }
  if (mode === 'blocked' && blocked === 0) errors.push('No blocked track; use complete only if verified.');
  return errors;
}

export function checkLocalSync(local, commit) {
  const errors = [];
  const fail = message => errors.push(`local_sync: ${message}`);
  if (!local || typeof local !== 'object') return ['local_sync: missing checkout and running-service verification.'];
  if (!text(local.checkout)) fail('missing canonical checkout path.');
  if (local.commit !== commit || local.remoteMain !== commit) fail('local HEAD and remote main must equal the exact shipped commit.');
  for (const field of ['trackedChanges', 'untrackedFiles']) {
    if (!Array.isArray(local[field]) || local[field].length) fail(`${field} must be an inspected empty list; leftover source work is not fully synchronized.`);
  }
  if (!timestamp(local.syncedAt) || !timestamp(local.checkedAt) || Date.parse(local.checkedAt) < Date.parse(local.syncedAt)) fail('missing ordered sync and verification timestamps.');
  for (const [id, port] of [['web', 5173], ['api', 8080], ['ios', 8081], ['proxy', 8099]]) {
    const service = local.services?.[id];
    if (!service) { fail(`${id}: missing running service.`); continue; }
    if (service.commit !== commit || service.checkout !== local.checkout) fail(`${id}: running source must match the canonical shipped checkout and commit.`);
    if (!Number.isInteger(service.pid) || service.pid <= 0) fail(`${id}: missing inspected process identity.`);
    if (!timestamp(service.startedAt) || Date.parse(service.startedAt) < Date.parse(local.syncedAt)) fail(`${id}: restart after local synchronization is required.`);
    if (!timestamp(service.checkedAt) || Date.parse(service.checkedAt) < Date.parse(service.startedAt) || Date.parse(service.checkedAt) > Date.parse(local.checkedAt)) fail(`${id}: missing ordered live inspection time.`);
    try {
      const url = new URL(service.url);
      if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.port !== String(port)) fail(`${id}: incorrect localhost address.`);
    } catch { fail(`${id}: missing localhost URL.`); }
    if (service.httpStatus !== 200) fail(`${id}: endpoint is not healthy.`);
    if (!text(service.sourceProof) || !/^[a-f0-9]{64}$/i.test(service.artifactSha256 ?? '')) fail(`${id}: inspect the served/built artifact and source; HTTP 200 alone is insufficient.`);
    if (['web', 'ios'].includes(id) && !text(service.browserProof)) fail(`${id}: rendered browser verification is required.`);
  }
  return errors;
}

// Re-read the checkout at the final CLI boundary: an earlier clean receipt cannot
// authorize completion after another chat changes files or the branch advances.
export function inspectLocalCheckout(local, commit, runGit = args =>
  execFileSync('git', ['-C', local.checkout, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim()) {
  try {
    const errors = [];
    if (runGit(['rev-parse', 'HEAD']) !== commit) errors.push('local_sync: current on-disk HEAD differs from the shipped commit.');
    if (runGit(['rev-parse', 'refs/remotes/origin/main']) !== commit) errors.push('local_sync: current origin/main differs from the shipped commit.');
    if (runGit(['status', '--porcelain', '--untracked-files=all'])) errors.push('local_sync: the checkout is currently dirty; earlier clean evidence is stale.');
    return errors;
  } catch { return ['local_sync: could not inspect the canonical checkout at completion time.']; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [file, mode] = process.argv.slice(2);
    const state = JSON.parse(readFileSync(file, 'utf8'));
    const errors = checkHandoff(state, mode);
    if (mode === 'complete' && errors.length === 0) errors.push(...inspectLocalCheckout(state.tracks.local_sync.verification, state.releaseCommit));
    if (errors.length) {
      console.error(`HANDOFF REFUSED\n${errors.map(error => `- ${error}`).join('\n')}`);
      process.exitCode = 1;
    } else console.log(mode === 'complete'
      ? 'Completion gate passed: all nine tracks, including exact local synchronization, have recorded verification evidence.'
      : 'Blocked handoff gate passed: release remains INCOMPLETE; report the documented boundaries.');
  } catch {
    console.error('HANDOFF REFUSED: supply a readable JSON ledger and complete or blocked mode.');
    process.exitCode = 1;
  }
}
