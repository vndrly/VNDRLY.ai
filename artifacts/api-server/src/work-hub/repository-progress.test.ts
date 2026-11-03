import { describe, it, expect, vi } from 'vitest';
vi.mock('./library-audience', () => ({ companyLibraryPeople: vi.fn(async () => [{userId:7,membershipId:9}]) }));
vi.mock('./vendor-repository', async (importOriginal) => ({ ...(await importOriginal<typeof import('./vendor-repository')>()), repositoryRecipientCanRead: vi.fn(async () => true) }));
import { repositoryRecipientCanRead } from './vendor-repository';
import { repositoryCertificationProgress } from './repository-certifications';
import { workHubFormTemplatesTable as templates, workHubFormInstancesTable as instances, workHubFileLibraryTable as records } from '@workspace/db';
const id='11111111-1111-4111-8111-111111111111';
const metadata={kind:'training',seriesId:id,contentVersion:1,state:'published'};
function reader(status='assigned', membershipId=9, version=1, hasCertificationExam=false, bundles:any[] = [], repository:any[] = []) {
 const result:any[]=[[{id,name:'Assigned course',libraryMetadata:metadata,hasCertificationExam},...bundles], [{instance:{id:'assignment',templateId:id,assigneeUserId:7,assignmentMetadata:{assignmentId:id,sourceItemId:id,contentVersion:version,membershipId,status,assignedAt:'2026-11-01T00:00:00Z',dueAt:'2026-12-01T00:00:00Z'}},submission:status==='completed'?new Date('2026-11-03T12:00:00Z'):null}], repository];
 return { select:vi.fn((fields?:Record<string,unknown>)=>{let value:any; const presence=fields&&Object.keys(fields).length===1&&'id'in fields; const chain:any={from:(table:unknown)=>{value=table===templates?result[0]:table===instances?result[1]:presence?repository.filter(row=>row.kind==='vendor_augmentation').slice(0,1):result[2];return chain;},where:()=>chain,limit:()=>chain,innerJoin:()=>chain,leftJoin:()=>chain,orderBy:()=>chain,then:(resolve:any)=>Promise.resolve(value).then(resolve)};return chain;}) } as any;
}
describe('direct assigned training progress',()=>{
 it('groups reused course assignments under their published bundle without granting a certification',async()=>{
  const bundle={id:'22222222-2222-4222-8222-222222222222',name:'Admin certificate',libraryMetadata:{...metadata,kind:'bundle'},bundleDefinition:{entries:[{templateId:id,contentVersion:1,dueHours:720,presentation:'immediate',requiredBeforeWork:false}]}};
  const p=await repositoryCertificationProgress(reader('assigned',9,1,false,[bundle]),{type:'vendor',id:1},7);
  expect(p.certifications).toContainEqual(expect.objectContaining({title:'Admin certificate',groupingOnly:true,steps:[expect.objectContaining({href:'/work-hub/training/assignment'})]}));
 });
 it('requires a passed exam even when full course content is excluded from the progress query',async()=>{
  const p=await repositoryCertificationProgress(reader('completed',9,1,true),{type:'vendor',id:1},7);
  expect(p.certifications).toMatchObject([{complete:false}]);
 });
 it('shows a standalone assigned course with its assignment link without granting a certification or bonus',async()=>{
 const p=await repositoryCertificationProgress(reader(),{type:'vendor',id:1},7);
 expect(p.certifications).toMatchObject([{standalone:true,complete:false,steps:[{href:'/work-hub/training/assignment',complete:false}]}]);
 expect(p.bonusScore).toBe(0);
 });
 it.each(['cancelled','exempted'])('omits %s assignments',async status=>{
 expect((await repositoryCertificationProgress(reader(status),{type:'vendor',id:1},7)).certifications).toEqual([]);
 });
 it('omits assignments for a previous membership or content revision',async()=>{
 for(const r of [reader('assigned',10),reader('assigned',9,2)])expect((await repositoryCertificationProgress(r,{type:'vendor',id:1},7)).certifications).toEqual([]);
 });
 it('recognizes verified submitted completion',async()=>{
 expect((await repositoryCertificationProgress(reader('completed'),{type:'vendor',id:1},7)).certifications).toMatchObject([{standalone:true,complete:true}]);
 });
});


describe('isolated server progress optimization equivalence', () => {
 it.each([
  ['assigned',9,1,false], ['completed',9,1,false],
  ['completed',9,1,true], ['cancelled',9,1,false],
  ['exempted',9,1,false], ['assigned',10,1,false],
  ['assigned',9,2,false], ['invalid',9,1,false],
 ] as const)('preserves output for %s membership %s version %s exam %s', async (status,membership,version,exam) => {
  const baseline = await repositoryCertificationProgress(reader(status,membership,version,exam),{type:'vendor',id:1},7);
  const optimized = await repositoryCertificationProgress(reader(status,membership,version,exam),{type:'vendor',id:1},7,{optimized:true});
  expect(optimized).toEqual(baseline);
 });
 it('preserves shared-course bundle grouping and company-wide output', async () => {
  const bundles = [1,2,3].map((n) => ({id:`bundle-${n}`,name:`Certificate ${n}`,libraryMetadata:{...metadata,kind:'bundle'},bundleDefinition:{entries:[{templateId:id,contentVersion:1,dueHours:720,presentation:'immediate',requiredBeforeWork:false}]}}));
  for (const userId of [7,null]) {
   const baseline = await repositoryCertificationProgress(reader('completed',9,1,false,bundles),{type:'vendor',id:1},userId);
   const optimized = await repositoryCertificationProgress(reader('completed',9,1,false,bundles),{type:'vendor',id:1},userId,{optimized:true});
   expect(optimized).toEqual(baseline);
  }
 });
});


describe('optimized material authorization reuse', () => {
 it.each([true,false])('preserves allowed=%s and checks a shared document once per request', async (allowed) => {
  const permission = vi.mocked(repositoryRecipientCanRead);
  permission.mockResolvedValue(allowed);
  const document = {id:'doc',kind:'document',orgType:'vendor',orgId:1,data:{scope:'company',state:'active',name:'Receipt',currentFileId:'file'}};
  const repository:any[] = [document];
  for (const n of [1,2]) {
   repository.push({id:`aug-${n}`,kind:'vendor_augmentation',data:{userIds:[7],baseItemId:id,title:`Aug ${n}`,required:true,documentIds:['doc']}});
   repository.push({id:`ack-${n}`,kind:'augmentation_ack',data:{augmentationId:`aug-${n}`,documentId:'doc',userId:7,fileId:'file'},updatedAt:new Date('2026-11-03T12:00:00Z')});
  }
  permission.mockClear();
  const baseline = await repositoryCertificationProgress(reader('completed',9,1,false,[],repository),{type:'vendor',id:1},7);
  expect(permission).toHaveBeenCalledTimes(2);
  permission.mockClear();
  const optimized = await repositoryCertificationProgress(reader('completed',9,1,false,[],repository),{type:'vendor',id:1},7,{optimized:true});
  expect(optimized).toEqual(baseline);
  expect(permission).toHaveBeenCalledTimes(1);
  const bonusOnly = await repositoryCertificationProgress(reader('completed',9,1,false,[],repository),{type:'vendor',id:1},null,{optimized:true,bonusOnly:true});
  expect({score:bonusOnly.bonusScore,completed:bonusOnly.bonusCompleted,required:bonusOnly.bonusRequired}).toEqual({score:baseline.bonusScore,completed:baseline.bonusCompleted,required:baseline.bonusRequired});
  expect(optimized.certifications.filter(c => c.augmented).map(c => c.steps.find(s => s.type === 'material')?.complete)).toEqual([allowed,allowed]);
 });
});

it('skips all non-augmented work for the safety bonus without changing the bonus',async()=>{
 const baseline=await repositoryCertificationProgress(reader('completed'),{type:'vendor',id:1},null);
 const optimized=await repositoryCertificationProgress(reader('completed'),{type:'vendor',id:1},null,{optimized:true,bonusOnly:true});
 expect(optimized.certifications).toEqual([]);
 expect(optimized.bonusScore).toBe(baseline.bonusScore);
 expect(optimized.bonusRequired).toBe(baseline.bonusRequired);
});

it('reads only augmentation presence when no bonus can exist',async()=>{
 const source=reader('completed',9,1,false,[],[{id:'document',kind:'document',data:{}}]);
 expect(await repositoryCertificationProgress(source,{type:'vendor',id:1},null,{optimized:true,bonusOnly:true})).toEqual({certifications:[],bonusScore:0,bonusCompleted:0,bonusRequired:0});
 expect(source.select).toHaveBeenCalledOnce();
});
