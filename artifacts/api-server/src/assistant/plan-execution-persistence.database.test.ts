import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFreshLocalTestDatabaseEnvironment } from '../../../../scripts/fresh-test-database.mjs';
import type { Pool } from 'pg';
import type { SessionPayload } from '../lib/session';
import type { PlanExecutionAuthorization } from './plan-execution';
import type { PrivatePlanExecutionStore } from './plan-execution-repository';

// No database imports/connections outside the wrapper's newly owned loopback DB.
const isolated = process.env.VNDRLY_TEST_DB_MODE === 'fresh-local' && process.env.VNDRLY_ISOLATED_TEST_DB === '1';
if (isolated) assertFreshLocalTestDatabaseEnvironment(process.env);

describe.skipIf(!isolated)('private plan execution PostgreSQL owner-row persistence', () => {
  let pool: Pool;
  let persistence: typeof import('./plan-execution-store');
  let repositories: typeof import('./plan-execution-repository');
  let consent: typeof import('./plan-execution-consent');
  let core: typeof import('./plan-execution');
  let ownerId: number;
  let now: number;
  let proposal: PlanExecutionAuthorization;
  let session: SessionPayload;
  let service: ReturnType<typeof import('./plan-execution-consent')['createPlanExecutionConsentService']>;
  let repository: ReturnType<typeof import('./plan-execution-repository')['createPrivatePlanExecutionRepository']>;

  beforeAll(async () => {
    assertFreshLocalTestDatabaseEnvironment(process.env);
    const pg = (await import('pg')).default;
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
    const target = new URL(process.env.DATABASE_URL!);
    const identity = (await pool.query('SELECT current_database() AS database, host(inet_server_addr()) AS address, inet_server_port() AS port')).rows[0];
    expect(identity).toEqual({ database: process.env.VNDRLY_FRESH_TEST_DB_NAME, address: '127.0.0.1', port: Number(target.port) });
    // Only the guarded additive private column; never reset, seed shared rows or enable a worker.
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS assistant_plan_executions jsonb');
    [persistence, repositories, consent, core] = await Promise.all([
      import('./plan-execution-store'), import('./plan-execution-repository'), import('./plan-execution-consent'), import('./plan-execution'),
    ]);
  });
  afterAll(async () => { await pool?.end(); });

  beforeEach(async () => {
    assertFreshLocalTestDatabaseEnvironment(process.env);
    const marker = `isolated-plan-persistence-${randomUUID()}@example.invalid`;
    ownerId = (await pool.query<{ id: number }>("INSERT INTO users(username, email, password_hash, role, display_name) VALUES ($1, $1, 'synthetic-unusable-password', 'field_employee', 'Synthetic isolated persistence owner') RETURNING id", [marker])).rows[0].id;
    now = Date.now();
    proposal = core.planExecutionAuthorizationSchema.parse({ id: randomUUID(), requester: { userId: ownerId, organizationKey: 'vendor:1', membershipId: 1, sessionVersion: 1 }, grantReference: 'synthetic-test-no-live-grant', taskId: randomUUID(), taskVersion: 1, planId: randomUUID(), planVersion: 1, planFingerprint: 'a'.repeat(64), approvedAt: now, expiresAt: now + 60000, maxAttempts: 2, steps: [{ id: 'read', adapter: 'authorized_read', toolName: 'list_work_hub_tasks', arguments: {}, dependsOn: [], operationId: randomUUID() }], notificationOperationId: randomUUID() });
    session = { userId: ownerId, role: 'vendor', vendorId: 1, activeMembershipId: 1, sv: 1 };
    const withRecords: typeof persistence.withPlanExecutionRecords = async (id, operation) => {
      expect(id).toBe(ownerId);
      return persistence.withPlanExecutionRecords(id, operation, pool);
    };
    // Canonical authority is deliberately injected: this test exercises real persistence,
    // not manufactured OAuth consent, real organizational roles or business effects.
    service = consent.createPlanExecutionConsentService({ secret: 'isolated-plan-signing-secret-no-live-authority', now: () => now, withRecords, authorize: async approved => ({ session, scopes: ['work_hub:read'], current: { ...approved.requester, grantReference: approved.grantReference, grantRevoked: false, taskId: approved.taskId, taskVersion: approved.taskVersion, planId: approved.planId, planVersion: approved.planVersion, planFingerprint: approved.planFingerprint, availableTools: ['list_work_hub_tasks'] } }) });
    const store: PrivatePlanExecutionStore = { eligibleOwnerIds: async () => [ownerId], withRecords };
    repository = repositories.createPrivatePlanExecutionRepository(store);
  });
  const records = () => persistence.withPlanExecutionRecords(ownerId, async values => structuredClone(values), pool);
  const approve = async () => { const prepared = await service.prepare(proposal, session); return service.approve(prepared.token, session); };

  it('serializes concurrent approval of the same signed review into exactly one durable run', async () => {
    const prepared = await service.prepare(proposal, session);
    const [first, second] = await Promise.all([service.approve(prepared.token, session), service.approve(prepared.token, session)]);
    expect(first).toEqual(second);
    expect(await records()).toHaveLength(1);
    expect((await records())[0]).toMatchObject({ run: { authorization: { id: proposal.id }, state: 'pending' }, fence: 0, leaseUntil: 0 });
  });
  it('allows one concurrent claim and fences expired owners after durable recovery', async () => {
    await approve();
    const claims = await Promise.all([repository.claimNext(now, now + 10000), repository.claimNext(now, now + 10000)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const old = claims.find(Boolean)!;
    const running = structuredClone(old.run); running.revision++; running.state = 'running'; running.steps[0].state = 'running'; running.steps[0].attempts = 1;
    expect(await repository.commit(old, old.run.revision, running, now + 1)).toBe(true);
    const recovered = (await repository.claimNext(now + 10000, now + 20000))!;
    expect(recovered.fence).toBe(old.fence + 1);
    expect(recovered.run.steps[0].state).toBe('running');
    expect(await repository.commit(old, running.revision, { ...running, revision: running.revision + 1 }, now + 10001)).toBe(false);
    await repository.release(old);
    expect(repositories.storedPlanExecutionSchema.parse((await records())[0]).leaseUntil).toBe(now + 20000);
  });
  it('durably cancels an in-flight run and refuses late commit without erasing unknown work', async () => {
    await approve(); const claim = (await repository.claimNext(now, now + 10000))!;
    const running = structuredClone(claim.run); running.revision++; running.state = 'running'; running.steps[0].state = 'running'; running.steps[0].attempts = 1;
    expect(await repository.commit(claim, claim.run.revision, running, now + 1)).toBe(true);
    const cancelled = await service.cancel(proposal.id, session);
    expect(cancelled).toMatchObject({ cancelRequested: true, state: 'outcome_unknown' });
    expect(await repository.commit(claim, running.revision, { ...running, revision: running.revision + 1 }, now + 2)).toBe(false);
    expect(await repository.claimNext(now + 10001, now + 20000)).toBeNull();
    await repository.release(claim);
    expect(repositories.storedPlanExecutionSchema.parse((await records())[0]).run).toEqual(cancelled);
  });
  it('preserves malformed unrelated private entries through approval, claim and cancel', async () => {
    const sentinel = { unrelated: 'synthetic-preservation', nested: { marker: randomUUID() } };
    await persistence.withPlanExecutionRecords(ownerId, async values => { values.push(sentinel); }, pool);
    await approve(); const claim = (await repository.claimNext(now, now + 10000))!;
    expect(claim.run.authorization.id).toBe(proposal.id);
    await service.cancel(proposal.id, session);
    expect((await records())[0]).toEqual(sentinel);
    expect(await records()).toHaveLength(2);
  });
  it('rolls back callback failure instead of publishing partially changed private records', async () => {
    await approve(); const before = await records();
    await expect(persistence.withPlanExecutionRecords(ownerId, async values => { values.push({ partial: true }); throw Error('synthetic rollback'); }, pool)).rejects.toThrow('synthetic rollback');
    expect(await records()).toEqual(before);
  });
});
