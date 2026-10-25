import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const TRACKS = ['commit', 'push', 'web', 'api', 'supabase', 'ota', 'testflight', 'plugin'];
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
    errors.push('Full ship scope must contain exactly all eight manifest tracks, without additions, omissions, or duplicates.');
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [file, mode] = process.argv.slice(2);
    const errors = checkHandoff(JSON.parse(readFileSync(file, 'utf8')), mode);
    if (errors.length) {
      console.error(`HANDOFF REFUSED\n${errors.map(error => `- ${error}`).join('\n')}`);
      process.exitCode = 1;
    } else console.log(mode === 'complete'
      ? 'Completion gate passed: all eight tracks have recorded verification evidence.'
      : 'Blocked handoff gate passed: release remains INCOMPLETE; report the documented boundaries.');
  } catch {
    console.error('HANDOFF REFUSED: supply a readable JSON ledger and complete or blocked mode.');
    process.exitCode = 1;
  }
}
