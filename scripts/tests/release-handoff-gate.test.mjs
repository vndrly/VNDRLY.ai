import test from 'node:test';
import assert from 'node:assert/strict';
import { checkHandoff, inspectLocalCheckout, TRACKS } from '../release-handoff-gate.mjs';

const commit = 'a'.repeat(40);
const proof = () => [{ source: 'mock://verified-result', observedAt: '2026-10-25T01:00:00Z', commit, result: 'Mock completion evidence' }];
function ledger() {
  const state = {
    authorization: { instruction: 'Full ship unattended.', scope: [...TRACKS], restrictions: ['No secret changes'],
      completionCriteria: ['Verify all nine tracks'], requestedAt: '2026-10-24T21:00:00Z', deadline: null },
    releaseCommit: commit, updatedAt: '2026-10-25T01:00:00Z', activeJobs: [],
    tracks: Object.fromEntries(TRACKS.map(id => [id, { status: 'verified', canProceed: false, nextAction: 'Verified complete', evidence: proof() }])),
  };
  state.tracks.local_sync.verification = {
    checkout: 'C:/workspace/app', commit, remoteMain: commit, trackedChanges: [], untrackedFiles: [],
    syncedAt: '2026-10-25T00:00:00Z', checkedAt: '2026-10-25T01:00:00Z',
    services: Object.fromEntries([['web', 5173], ['api', 8080], ['ios', 8081], ['proxy', 8099]].map(([id, port]) => [id, {
      checkout: 'C:/workspace/app', commit, pid: 123, startedAt: '2026-10-25T00:10:00Z',
      checkedAt: '2026-10-25T00:30:00Z', url: `http://localhost:${port}/`, httpStatus: 200,
      sourceProof: 'mock://inspected-process-and-artifact', artifactSha256: 'c'.repeat(64), browserProof: 'mock://rendered-page',
    }])),
  };
  return state;
}
function blockPlugin(state) {
  state.tracks.plugin = { status: 'blocked', canProceed: false, nextAction: 'Resume upload after access is restored',
    blocker: { reason: 'Supported upload unavailable', attempts: proof(),
      alternativesConsidered: ['Other supported browser has no authenticated session'], requiredExternalChange: 'Restore an authenticated upload-capable session' } };
}

test('rejects narrowed, expanded, or duplicated authorization scope', () => {
  for (const scope of [TRACKS.slice(0, 7), [...TRACKS, 'personal-install'], [...TRACKS.slice(0, 7), 'commit']]) {
    const state = ledger(); state.authorization.scope = scope;
    assert.ok(checkHandoff(state, 'complete').some(error => error.includes('exactly all nine')));
  }
});
test('rejects an invented personal installation track even when labeled verified', () => {
  const state = ledger();
  state.tracks['personal-install'] = { status: 'verified', canProceed: false, nextAction: 'Done', evidence: proof() };
  assert.ok(checkHandoff(state, 'complete').some(error => error.includes('not a full-ship manifest track')));
});

test('requires all nine verified tracks for completion', () => {
  assert.deepEqual(checkHandoff(ledger(), 'complete'), []);
  for (const id of TRACKS) {
    const state = ledger(); delete state.tracks[id];
    assert.ok(checkHandoff(state, 'complete').some(error => error.includes(id)));
  }
});

test('rejects the former eight-track definition even if every old track passed', () => {
  const state = ledger();
  state.authorization.scope = TRACKS.filter(id => id !== 'local_sync');
  delete state.tracks.local_sync;
  assert.ok(checkHandoff(state, 'complete').some(error => error.includes('local_sync')));
});
test('rejects stale local HEAD, remote mismatch, dirty source and missing previews', () => {
  for (const mutate of [
    v => { v.commit = 'b'.repeat(40); },
    v => { v.remoteMain = 'b'.repeat(40); },
    v => { v.trackedChanges = [' M app.ts']; },
    v => { v.untrackedFiles = ['new-code.ts']; },
    v => { delete v.services.ios; },
    v => { delete v.services.proxy; },
    v => { v.services.web.checkout = 'C:/stale/checkout'; },
    v => { v.services.api.commit = 'b'.repeat(40); },
    v => { v.services.ios.startedAt = '2026-10-24T00:00:00Z'; },
    v => { delete v.services.web.browserProof; },
    v => { delete v.services.api.artifactSha256; },
    v => { v.services.web.url = 'https://vndrly.ai'; },
    v => { v.services.ios.httpStatus = 500; },
  ]) {
    const state = ledger(); mutate(state.tracks.local_sync.verification);
    assert.ok(checkHandoff(state, 'complete').some(error => error.startsWith('local_sync:')));
  }
});
test('HTTP 200 on all ports without inspected source is not a full ship', () => {
  const state = ledger();
  for (const service of Object.values(state.tracks.local_sync.verification.services)) delete service.sourceProof;
  assert.ok(checkHandoff(state, 'complete').length);
});

test('completion re-reads disk and rejects a previously clean receipt after edits', () => {
  const local = ledger().tracks.local_sync.verification;
  assert.deepEqual(inspectLocalCheckout(local, commit, args => args[0] === 'status' ? '' : commit), []);
  assert.ok(inspectLocalCheckout(local, commit, args => args[0] === 'status' ? ' M app.ts' : commit).length);
  assert.ok(inspectLocalCheckout(local, commit, args => args[0] === 'status' ? '' : 'b'.repeat(40)).length);
  assert.ok(inspectLocalCheckout(local, commit, () => { throw new Error('unavailable'); }).length);
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
