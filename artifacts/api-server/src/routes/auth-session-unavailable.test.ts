import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { buildTestCookie } from '../test-utils/session';

const state = vi.hoisted(() => ({
 select: vi.fn(), failure: 'user' as 'user'|'context'|null, missingUser:false,
}));
vi.mock('@workspace/db', async original => ({
 ...await original<any>(), db:{select:state.select},
}));
import authRouter from './auth';

const app=express();
app.use(cookieParser());
app.use(express.json());
app.use('/api',authRouter);
const session={userId:7123,role:'admin'};

beforeEach(()=>{
 vi.clearAllMocks(); state.failure='user'; state.missingUser=false;
 state.select.mockImplementation(()=>{
  const query:any={
   from:()=>query,leftJoin:()=>query,where:()=>query,
   limit:async()=>{
    if(state.failure==='user') throw new Error('Database connection timed out');
    return state.missingUser?[]:[{id:7123,role:'admin',activeMembershipId:null,preferredLanguage:'en',mustChangePassword:false}];
   },
   orderBy:async()=>{
    if(state.failure==='context') throw new Error('Membership query connection reset');
    return [];
   },
  };
  return query;
 });
});

describe('GET /auth/me transient availability versus invalid authentication',()=>{
 it.each(['user','context'] as const)('preserves the signed cookie when the %s database lookup fails, then accepts it after recovery',async failure=>{
  state.failure=failure;
  const cookie=buildTestCookie(session);
  const unavailable=await request(app).get('/api/auth/me').set('Cookie',cookie);
  expect(unavailable.status).toBe(503);
  expect(unavailable.body.code).toBe('auth.session_temporarily_unavailable');
  expect(unavailable.headers['set-cookie']).toBeUndefined();
  expect(state.select).toHaveBeenCalled();

  state.failure=null;
  const recovered=await request(app).get('/api/auth/me').set('Cookie',cookie);
  expect(recovered.status).toBe(200);
  expect(recovered.body).toMatchObject({userId:7123,role:'admin'});
  expect(recovered.headers['set-cookie']).toBeUndefined();
 });

 it('rejects an invalid signature with 401 and clears its cookie without querying the database',async()=>{
  const invalid=await request(app).get('/api/auth/me').set('Cookie',buildTestCookie(session,{secret:'incorrect-test-secret'}));
  expect(invalid.status).toBe(401);
  expect(invalid.body.code).toBe('auth.not_authenticated');
  expect(String(invalid.headers['set-cookie'] ?? '')).toContain('vndrly_session=;');
  expect(state.select).not.toHaveBeenCalled();
 });

 it('rejects a malformed signature rather than presenting it as a database outage',async()=>{
  const invalid=await request(app).get('/api/auth/me').set('Cookie','vndrly_session=payload.short');
  expect(invalid.status).toBe(401);
  expect(invalid.body.code).toBe('auth.not_authenticated');
  expect(state.select).not.toHaveBeenCalled();
 });

 it('continues to reject a validly signed session whose user is confirmed missing',async()=>{
  state.failure=null; state.missingUser=true;
  const missing=await request(app).get('/api/auth/me').set('Cookie',buildTestCookie(session));
  expect(missing.status).toBe(401);
  expect(missing.body.code).toBe('auth.not_authenticated');
  expect(String(missing.headers['set-cookie'] ?? '')).toContain('vndrly_session=;');
 });
});
