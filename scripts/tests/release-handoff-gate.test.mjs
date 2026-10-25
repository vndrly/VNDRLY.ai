import test from 'node:test';
import assert from 'node:assert/strict';
import { checkHandoff, TRACKS } from '../release-handoff-gate.mjs';

const commit = 'a'.repeat(40);
const proof = () => [{ source: 'mock://verified-result', observedAt: '2026-10-25T01:00:00Z', commit, result: 'Mock completion evidence' }];
function ledger() {
  return {
    authorization: { instruction: 'Full ship unattended.', scope: [...TRACKS], restrictions: ['No secret changes'],
      completionCriteria: ['Verify all eight tracks'], requestedAt: '2026-10-24T21:00:00Z', deadline: null },
    releaseCommit: commit, updatedAt: '2026-10-25T01:00:00Z', activeJobs: [],
    tracks: Object.fromEntries(TRACKS.map(id => [id, { status: 'verified', canProceed: false, nextAction: 'Verified complete', evidence: proof() }])),
  };
}
function blockPlugin(state) {
  state.tracks.plugin = { status: 'blocked', canProceed: false, nextAction: 'Resume upload after access is restored',
    blocker: { reason: 'Supported upload unavailable', attempts: proof(),
      alternativesConsidered: ['Other supported browser has no authenticated session'], requiredExternalChange: 'Restore an authenticated upload-capable session' } };
}

test('requires all eight verified tracks for completion', () => {
  assert.deepEqual(checkHandoff(ledger(), 'complete'), []);
  for (const id of TRACKS) {
    const state = ledger(); delete state.tracks[id];
    assert.ok(checkHandoff(state, 'complete').some(error => error.includes(id)));
  }
});
test('original failure: plugin blocker cannot justify exit while OTA or TestFlight runs', () => {
  const state = ledger(); blockPlugin(state);
  state.tracks.ota.status = 'running'; state.tracks.testflight.status = 'running';
  state.activeJobs = [{ id: 'mock-testflight-job', track: 'testflight' }];
  const errors = checkHandoff(state, 'blocked');
  assert.ok(errors.some(error => error.includes('ota')));
  assert.ok(errors.some(error => error.includes('testflight')));
  assert.ok(errors.some(error => error.includes('active jobs')));
});
test('blocked handoff is allowed only with documented exhausted alternatives', () => {
  const state = ledger(); blockPlugin(state);
  assert.deepEqual(checkHandoff(state, 'blocked'), []);
  assert.ok(checkHandoff(state, 'complete').length);
  state.tracks.plugin.blocker.alternativesConsidered = [];
  assert.ok(checkHandoff(state, 'blocked').length);
});
test('rejects runnable work even if labeled verified or blocked', () => {
  const state = ledger(); state.tracks.web.canProceed = true;
  assert.ok(checkHandoff(state, 'complete').length);
  blockPlugin(state); state.tracks.plugin.canProceed = true;
  assert.ok(checkHandoff(state, 'blocked').length);
});
test('rejects evidence from another release and unverified dispatch', () => {
  const state = ledger(); state.tracks.api.evidence[0].commit = 'b'.repeat(40);
  assert.ok(checkHandoff(state, 'complete').length);
  state.tracks.testflight = { status: 'pending', canProceed: true, nextAction: 'Inspect submission' };
  assert.ok(checkHandoff(state, 'complete').some(error => error.includes('testflight')));
});
test('fails closed when authorization, checkpoint, mode, or process inventory is missing', () => {
  for (const key of ['authorization', 'releaseCommit', 'updatedAt', 'activeJobs', 'tracks']) {
    const state = ledger(); delete state[key];
    assert.ok(checkHandoff(state, 'complete').length, key);
  }
  assert.ok(checkHandoff(null, 'complete').length);
  assert.ok(checkHandoff(ledger(), 'skip').length);
  assert.ok(checkHandoff(ledger(), 'blocked').length);
});
