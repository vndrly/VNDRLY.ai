import {beforeEach,describe,it,expect,vi} from 'vitest';
import {PgDialect} from 'drizzle-orm/pg-core';
const mocks=vi.hoisted(()=>({execute:vi.fn(),authority:vi.fn(),audience:vi.fn(),notice:vi.fn(),holds:vi.fn()}));
vi.mock('@workspace/db',()=>({db:{execute:mocks.execute,transaction:(run:any)=>run({execute:mocks.execute})}}));
vi.mock('./library-core',()=>({libraryAuthority:mocks.authority,LibraryError:class extends Error{constructor(message:string,public status=409){super(message);}}}));
vi.mock('./library-audience',()=>({expandLibraryAudience:mocks.audience,companyLibraryPeople:vi.fn()}));
vi.mock('./form-campaign-service',()=>({queueCampaignNotice:mocks.notice}));
vi.mock('../lib/notification-company-hold',()=>({pausedNotificationUserIds:mocks.holds}));
import {readCatalogInstruction,updateCatalogInstruction,assignCatalogTraining,readCatalogExam,updateCatalogExam} from './catalog-training';
const actor={userId:901,vendorId:990,source:'web' as const};
beforeEach(()=>{vi.clearAllMocks();mocks.authority.mockResolvedValue({owner:{type:'vendor',id:990},member:{role:'admin'}});mocks.holds.mockResolvedValue(new Set());});
describe('shared catalog instruction persistence',()=>{
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
