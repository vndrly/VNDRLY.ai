import {beforeEach,describe,it,expect,vi} from 'vitest';
import {PgDialect} from 'drizzle-orm/pg-core';
const mocks=vi.hoisted(()=>({execute:vi.fn(),authority:vi.fn(),audience:vi.fn(),notice:vi.fn(),holds:vi.fn()}));
vi.mock('@workspace/db',()=>({db:{execute:mocks.execute,transaction:(run:any)=>run({execute:mocks.execute})}}));
vi.mock('./library-core',()=>({libraryAuthority:mocks.authority,LibraryError:class extends Error{constructor(message:string,public status=409){super(message);}}}));
vi.mock('./library-audience',()=>({expandLibraryAudience:mocks.audience,companyLibraryPeople:vi.fn()}));
vi.mock('./form-campaign-service',()=>({queueCampaignNotice:mocks.notice}));
vi.mock('../lib/notification-company-hold',()=>({pausedNotificationUserIds:mocks.holds}));
import {updateCatalogCredential,readCatalogInstruction,updateCatalogInstruction,assignCatalogTraining,readCatalogExam,updateCatalogExam,catalogTrainingState} from './catalog-training';
import onlineInstruction from '../data/online-instruction.json';
const actor={userId:901,vendorId:990,source:'web' as const};
beforeEach(()=>{vi.clearAllMocks();mocks.authority.mockResolvedValue({owner:{type:'vendor',id:990},member:{role:'admin'}});mocks.holds.mockResolvedValue(new Set());});
describe('shared catalog instruction persistence',()=>{
 it('shows completed instruction but does not award Site Security before its final assessment',async()=>{
  const rows=onlineInstruction.courses.filter(c=>c.id.startsWith('VUC116-')).map(c=>({courseId:c.id,sources:['VUC116'],progress:{instruction:{reviewed:c.sessions.map(s=>s.id),updatedAt:'2026-11-19T12:00:00Z',responses:Object.fromEntries(c.sessions.flatMap(s=>s.checks.map(q=>[q.id,{attempts:[{correct:true}]}])))}}}));
  mocks.execute.mockResolvedValueOnce({rows}).mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[]});
  const data=await catalogTrainingState(actor);
  expect(data.programs.find(p=>p.id==='VUC116')).toMatchObject({percent:100,complete:false,awardedAt:null});
  for(const call of mocks.execute.mock.calls)expect(new PgDialect().sqlToQuery(call[0]).params).toEqual(['vendor',990,901]);
 });
 it('keeps unstarted assigned courses visible at zero without claiming completion',async()=>{
  mocks.execute.mockResolvedValueOnce({rows:[{courseId:'VUC116-C01',sources:['VUC116'],progress:{}}]}).mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[]});
  const data=await catalogTrainingState(actor);
  expect(data.programs[0]).toMatchObject({percent:0,complete:false});
  expect(data.courses[0].benchmarks.every(b=>!b.complete&&b.reviewedAt===null)).toBe(true);
 });
 it('does not permit an unassigned certification assessment',async()=>{
  mocks.execute.mockResolvedValueOnce({rows:[{course_id:'VUC116-C01'}]});
  await expect(updateCatalogExam(actor,'VUC116',{action:'start'})).rejects.toMatchObject({status:403});
  expect(mocks.execute).toHaveBeenCalledTimes(1);
  expect(new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]).params).toEqual(['vendor',990,901]);
 });
 it('reads only the current user and company certification record',async()=>{
  mocks.execute.mockResolvedValueOnce({rows:[1,2,3,4].map(n=>({course_id:`VUC116-C0${n}`}))}).mockResolvedValueOnce({rows:[]});
  const result=await readCatalogExam(actor,'VUC116');
  expect(result).toMatchObject({available:true,assigned:true,passingPercent:80,questionCount:20,questions:[]});
  expect(new PgDialect().sqlToQuery(mocks.execute.mock.calls[1][0]).params).toEqual(['vendor',990,901,'VUC116']);
 });
 it('locks the unique record before saving an assessment attempt',async()=>{
  mocks.execute.mockResolvedValueOnce({rows:[1,2,3,4].map(n=>({course_id:`VUC116-C0${n}`}))})
   .mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{id:'record',progress:{attempts:[]}}]}).mockResolvedValueOnce({rows:[]});
  const result=await updateCatalogExam(actor,'VUC116',{action:'start'});
  expect(result.attempt?.answers).toEqual({});
  expect(result.questions.every(q=>!('correct' in q))).toBe(true);
  expect(new PgDialect().sqlToQuery(mocks.execute.mock.calls[1][0]).sql).toContain('ON CONFLICT');
  expect(new PgDialect().sqlToQuery(mocks.execute.mock.calls[2][0]).sql).toContain('FOR UPDATE');
 });
 it('requires the current user’s company-scoped assignment for progress writes',async()=>{
  mocks.execute.mockResolvedValueOnce({rows:[]});
  await expect(updateCatalogInstruction(actor,'VUC001-C04',{action:'start'})).rejects.toMatchObject({status:403});
  const query=new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]);
  expect(query.params).toEqual(['vendor',990,901,'VUC001-C04']);
  expect(query.sql).toContain('FOR UPDATE');
  expect(mocks.execute).toHaveBeenCalledTimes(1);
 });
 it('returns instruction without answer keys before the learner attempts checks',async()=>{
  mocks.execute.mockResolvedValueOnce({rows:[{progress:{}}]});
  const data=await readCatalogInstruction(actor,'VUC001-C04');
  expect(data.assigned).toBe(true);
  expect('sessions' in data&&data.sessions.flatMap(s=>s.checks).every(q=>!('answer' in q))).toBe(true);
 });
 it('saves instruction progress without overwriting unrelated progress',async()=>{
  mocks.execute.mockResolvedValueOnce({rows:[{id:'assignment',progress:{reviewed:['existing-lesson']}}]}).mockResolvedValueOnce({rows:[]});
  await updateCatalogInstruction(actor,'VUC001-C04',{action:'start'});
  const query=new PgDialect().sqlToQuery(mocks.execute.mock.calls[1][0]);
  const saved=JSON.parse(query.params[0] as string);
  expect(saved.reviewed).toEqual(['existing-lesson']);
  expect(saved.instruction.sessionId).toBe('ESC01-1');
  expect(saved).not.toHaveProperty('completed');
 });
 it('preserves the notification hold while assigning the shared course',async()=>{
  mocks.audience.mockResolvedValue({owner:{type:'vendor',id:990},people:[{userId:901}],excluded:[]});
  mocks.holds.mockResolvedValue(new Set([901]));
  mocks.execute.mockResolvedValue({rows:[{id:'assignment'}]});
  await assignCatalogTraining(actor,{targetId:'VUC001-C04',audience:{mode:'selected',userIds:[901],groupIds:[]}});
  expect(mocks.notice).not.toHaveBeenCalled();
  const query=new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]);
  expect(query.sql).toContain('ON CONFLICT');
  expect(query.sql).not.toMatch(/progress\s*=/);
 });
});

it('edits profile details without modifying award or assessment evidence',async()=>{
 const progress={credential:{awardedAt:'2026-11-12T12:00:00Z'},attempts:[{score:95}],other:'preserved'};
 mocks.execute.mockResolvedValueOnce({rows:[{id:'record',progress}]}).mockResolvedValueOnce({rows:[]});
 await updateCatalogCredential(actor,'VUC116',{certNumber:'ABC',awardedAt:'2026-11-12',expiresAt:'2027-11-12'});
 const query=new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]);
 expect(query.params).toEqual(['vendor',990,901,'VUC116']);expect(query.sql).toContain('FOR UPDATE');
 const saved=JSON.parse(new PgDialect().sqlToQuery(mocks.execute.mock.calls[1][0]).params[0] as string);
 expect(saved).toMatchObject({...progress,profileRecord:{certNumber:'ABC',expiresAt:'2027-11-12'}});
});
it('removes the profile card without deleting the earned award or coursework',async()=>{
 const progress={credential:{awardedAt:'2026-11-12'},attempts:[{score:95}]};
 mocks.execute.mockResolvedValueOnce({rows:[{id:'record',progress}]}).mockResolvedValueOnce({rows:[]});
 await updateCatalogCredential(actor,'VUC116',null,true);
 const query=new PgDialect().sqlToQuery(mocks.execute.mock.calls[1][0]);
 expect(query.sql).not.toContain('DELETE');expect(JSON.parse(query.params[0] as string)).toMatchObject({...progress,profileRecord:{removedAt:expect.any(String)}});
});
it('rejects another user or company record and invalid date order',async()=>{
 mocks.execute.mockResolvedValueOnce({rows:[]});
 await expect(updateCatalogCredential(actor,'VUC116',{certNumber:'',awardedAt:null,expiresAt:null})).rejects.toMatchObject({status:404});
 await expect(updateCatalogCredential(actor,'VUC116',{certNumber:'',awardedAt:'2027-01-01',expiresAt:'2026-01-01'})).rejects.toThrow();
 expect(mocks.execute).toHaveBeenCalledTimes(1);
});

it('keeps the profile response valid after removing a card without prior edits',async()=>{
 mocks.execute.mockResolvedValueOnce({rows:[{courseId:'VUC116-C01',sources:['VUC116'],progress:{}}]}).mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{programId:'VUC116',progress:{attempts:[],credential:{awardedAt:'2026-11-12',expiresAt:'2027-11-12'},profileRecord:{removedAt:'2026-11-20'}}}]});
 const data=await catalogTrainingState(actor);
 expect(data.programs[0]).toMatchObject({profileHidden:true,awardedAt:'2026-11-12',expiresAt:'2027-11-12'});
});
