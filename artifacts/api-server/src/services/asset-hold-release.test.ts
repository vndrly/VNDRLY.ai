import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import type { SessionPayload } from '../lib/session';
vi.mock('@workspace/db', () => ({ pool: { connect: vi.fn() } }));
import { createAssetHoldReleaseService } from './asset-hold-release';
function fixture() {
 const asset = { id: randomUUID(), responsible_org_type: 'vendor', responsible_org_id: 7, version: 1, status: 'held', current_holder_user_id: 12, condition: 'good' };
 const ids = [randomUUID(), randomUUID()];
 let holds = ids.map(id => ({ id, reason: 'Reported hold', placed_at: new Date(), fleet_owned: false }));
 let prior: Record<string, unknown> | null = null, member = true, manager = true, person = false;
 const query = vi.fn(async (sql: string, args: unknown[] = []) => {
  if (sql.includes('SELECT * FROM assets')) return { rows: [asset] };
  if (sql.includes('SELECT role FROM users')) return { rows: [{ role: 'vendor' }] };
  if (sql.includes('FROM user_org_memberships')) return { rows: member ? [{ role: manager ? 'admin' : 'member',vendor_people_id:person?10:null }] : [] };
  if(sql.includes('FROM vendor_people'))return {rows:person?[{id:10}]:[]};
  if (sql.includes('SELECT g.id')) return { rows: [] };
  if (sql.includes('SELECT asset_id')) return { rows: prior && prior.operationId === args[0] ? [prior] : [] };
  if (sql.includes('SELECT h.id')) return { rows: holds };
  if (sql.includes('UPDATE asset_holds')) { holds = holds.filter(h => h.id !== args[1]); return { rows: [{ id: args[1] }] }; }
  if (sql.includes('UPDATE assets')) { asset.status = String(args[0]); asset.version++; return { rows: [] }; }
  if (sql.includes('INSERT INTO asset_custody')) { prior = { operationId: args[0], asset_id: asset.id, actor_user_id: 3, event_type: 'hold_release', asset_version: args[3], command_fingerprint: args[4] }; }
  return { rows: [] };
 });
 const service = createAssetHoldReleaseService({ connect: async () => ({ query, release: vi.fn() }) as unknown as PoolClient } as Pick<Pool, 'connect'>);
 const session = { userId: 3, sv: 1, role: 'vendor', vendorId: 7, activeMembershipId: 8, membershipRole: 'admin' } as SessionPayload;
 const body = { operationId: randomUUID(), expectedVersion: 1, reason: 'Administrative release only' };
 return { asset, ids, session, body, service, query, get holds() { return holds; }, set fleet(v: boolean) { holds[0].fleet_owned = v; }, set member(v: boolean) { member = v; }, set manager(v: boolean) { manager = v; }, set person(v:boolean){person=v;} };
}
it('preserves other holds and custody, and returns exact original result on replay after later versions', async () => {
 const f = fixture(); const first = await f.service.release(f.session, f.asset.id, f.ids[0], f.body);
 expect(f.holds.map(h => h.id)).toEqual([f.ids[1]]); expect(f.asset).toMatchObject({ status: 'held', current_holder_user_id: 12, version: 2, condition:'good' });
 f.asset.version = 5; expect(await f.service.release(f.session, f.asset.id, f.ids[0], f.body)).toEqual(first);
 expect(f.query.mock.calls.filter(([q]) => q.includes('INSERT INTO asset_custody'))).toHaveLength(1);
 await expect(f.service.release(f.session, f.asset.id, f.ids[0], { ...f.body, reason: 'Different' })).rejects.toHaveProperty('code', 'asset.operation_reused');
});
it('rejects stale versions, foreign owner and Fleet holds before any write', async () => {
 for (const kind of ['version', 'owner', 'fleet']) { const f = fixture(); if (kind === 'fleet') f.fleet = true;
  await expect(f.service.release(kind === 'owner' ? { ...f.session, vendorId: 9 } : f.session, f.asset.id, f.ids[0], kind === 'version' ? { ...f.body, expectedVersion: 2 } : f.body)).rejects.toHaveProperty('code', kind === 'version' ? 'asset.version_conflict' : kind === 'owner' ? 'asset.not_found' : 'asset.fleet_maintenance_release_required');
  expect(f.query.mock.calls.some(([q]) => q.startsWith('UPDATE'))).toBe(false);
 }
});
it('rechecks current membership and persisted management authority even before replay', async () => {
 const f = fixture(); await f.service.release(f.session, f.asset.id, f.ids[0], f.body); f.member = false;
 await expect(f.service.release(f.session, f.asset.id, f.ids[0], f.body)).rejects.toHaveProperty('code', 'asset.current_membership_required');
 const worker = fixture(); worker.manager = false;
 await expect(worker.service.release({...worker.session,vendorRole:'asset_manager'}, worker.asset.id, worker.ids[0], worker.body)).rejects.toHaveProperty('code', 'asset.asset_manager_required');
});
it('restores checked-out state only after the final selected hold release without changing its holder', async () => {
 const f = fixture(); await f.service.release(f.session, f.asset.id, f.ids[0], f.body);
 await f.service.release(f.session, f.asset.id, f.ids[1], { ...f.body, operationId: randomUUID(), expectedVersion: 2 });
 expect(f.asset).toMatchObject({ status: 'checked_out', current_holder_user_id: 12 });
});

it('accepts a current linked active Inventory manager row without trusting the session role label',async()=>{const f=fixture();f.manager=false;f.person=true;expect(await f.service.release({...f.session,vendorRole:'field'},f.asset.id,f.ids[0],f.body)).toMatchObject({status:'applied'});});
