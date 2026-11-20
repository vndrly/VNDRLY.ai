import { beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
const state = vi.hoisted(() => ({ role: 'field_employee', allowed: true, saved: {} as any, calls: 0, rows: [] as any[] }));
vi.mock('@workspace/db', () => ({
  employeeLicensesTable: { id: 'id', employeeId: 'employeeId', deletedAt: 'deletedAt' },
  db: {
    select: () => { state.calls++; return { from: () => ({ where: async () => state.rows }) }; },
    insert: () => { state.calls++; return { values: (values: any) => { state.saved = values; return { returning: async () => [{ ...values, id: 9, verifiedAt: null, verificationSource: null }] }; } }; },
    update: () => { state.calls++; return { set: (values: any) => { state.saved = values; return { where: () => ({ returning: async () => [{ id: 9, details: {}, ...values }] }) }; } }; },
  },
}));
vi.mock('drizzle-orm', () => ({ and: (...args: any[]) => args, eq: (...args: any[]) => args, isNull: (arg: any) => arg }));
import { registerProfileLicenses } from './profileLicenses';
const app = express(); app.use(express.json());
const access = async (_req: any, res: any) => {
  if (!state.allowed) { res.status(403).json({ error: 'Not allowed' }); return null; }
  return { session: { userId: 5, role: state.role } };
};
registerProfileLicenses(app, { read: access, mutate: access });
const data = { type: 'equipment-authorization', issuer: 'Synthetic employer', jurisdiction: '', number: '', scope: 'Class IV forklift', restrictions: '', issuedDate: '', expirationDate: '', noExpiration: true, documentUrl: '', evaluationDate: '2026-01-01', evaluator: 'Synthetic evaluator', trainingReference: 'Evaluation TEST-ONLY' };
beforeEach(() => { state.role = 'field_employee'; state.allowed = true; state.calls = 0; state.saved = {}; state.rows = []; });
it('never accesses records when the employee access check denies the caller', async () => {
  state.allowed = false;
  expect((await request(app).get('/field-employees/7/licenses')).status).toBe(403);
  expect((await request(app).post('/field-employees/7/licenses').send(data)).status).toBe(403);
  expect(state.calls).toBe(0);
});
it('stores records without assigning verification and rejects extra fields', async () => {
  state.role = 'vendor';
  const result = await request(app).post('/field-employees/7/licenses').send(data);
  expect(result.status).toBe(201);
  expect(result.body.verifiedAt).toBeUndefined();
  expect(state.saved.employeeId).toBe(7);
  expect((await request(app).post('/field-employees/7/licenses').send({ ...data, verifiedAt: '2026-01-01' })).status).toBe(400);
});
it('allows editing recorded details without an approval step', async () => {
  expect((await request(app).put('/field-employees/7/licenses/9').send(data)).status).toBe(200);
  expect(state.saved).toEqual({ details: data });
});
it('soft-removes a record and rejects invalid identifiers before storage access', async () => {
  expect((await request(app).delete('/field-employees/7/licenses/9')).status).toBe(204);
  expect(state.saved.deletedAt).toBeInstanceOf(Date);
  state.calls = 0;
  expect((await request(app).get('/field-employees/not-an-id/licenses')).status).toBe(400);
  expect(state.calls).toBe(0);
});
it('round-trips CDL fields and separate private front/back photos without losing the supporting document', async () => {
  const cdl = {...data,type:'driver',number:'SYNTHETIC-CDL-1',holderName:'Example Driver',licenseClass:'A',endorsements:'N, T',jurisdiction:'Oklahoma',frontPhotoUrl:'/api/storage/objects/uploads/front',backPhotoUrl:'/api/storage/objects/uploads/back',documentUrl:'/api/storage/objects/uploads/support'};
  const saved=await request(app).put('/field-employees/7/licenses/9').send(cdl);
  expect(saved.status).toBe(200);expect(saved.body).toMatchObject(cdl);
  state.rows=[{id:9,details:state.saved.details}];
  expect((await request(app).get('/field-employees/7/licenses')).body[0]).toMatchObject(cdl);
  expect((await request(app).put('/field-employees/7/licenses/9').send({...cdl,frontPhotoUrl:'https://untrusted.example/front'})).status).toBe(400);
});
