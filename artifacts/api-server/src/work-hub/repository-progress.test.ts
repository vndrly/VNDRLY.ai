import { describe, it, expect, vi } from 'vitest';
const { storedTrainingProjection } = vi.hoisted(() => ({ storedTrainingProjection: vi.fn(async (_key: string, compute: () => Promise<unknown>) => compute()) }));
vi.mock('./stored-training-projections', () => ({ storedTrainingProjection }));
vi.mock('./library-audience', () => ({ companyLibraryPeople: vi.fn(async () => [{userId:7,membershipId:9}]) }));
vi.mock('./vendor-repository', async (importOriginal) => ({ ...(await importOriginal<typeof import('./vendor-repository')>()), repositoryRecipientCanRead: vi.fn(async () => true) }));
import { repositoryRecipientCanRead } from './vendor-repository';
import { repositoryCertificationProgress, trainingDisplaySummary } from './repository-certifications';
import { workHubFormTemplatesTable as templates, workHubFormInstancesTable as instances, workHubFileLibraryTable as records, userOrgMembershipsTable as memberships } from '@workspace/db';
const id='11111111-1111-4111-8111-111111111111';
const metadata={kind:'training',seriesId:id,contentVersion:1,state:'published'};
function reader(status='assigned', membershipId=9, version=1, hasCertificationExam=false, bundles:any[] = [], repository:any[] = []) {
 const result:any[]=[[{id,name:'Assigned course',libraryMetadata:metadata,hasCertificationExam},...bundles], [{instance:{id:'assignment',templateId:id,assigneeUserId:7,assignmentMetadata:{assignmentId:id,sourceItemId:id,contentVersion:version,membershipId,status,assignedAt:'2026-11-01T00:00:00Z',dueAt:'2026-12-01T00:00:00Z'}},submission:status==='completed'?new Date('2026-11-03T12:00:00Z'):null}], repository];
 return { select:vi.fn((fields?:Record<string,unknown>)=>{let value:any; const presence=fields&&Object.keys(fields).length===1&&'id'in fields; const chain:any={from:(table:unknown)=>{value=table===memberships?[{id:9}]:table===templates?result[0]:table===instances?result[1]:presence?repository.filter(row=>row.kind==='vendor_augmentation').slice(0,1):result[2];return chain;},where:()=>chain,limit:()=>chain,innerJoin:()=>chain,leftJoin:()=>chain,orderBy:()=>chain,then:(resolve:any)=>Promise.resolve(value).then(resolve)};return chain;}) } as any;
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

it('uses the same complete stored snapshot for safety bonus and company progress',async()=>{
 const baseline=await repositoryCertificationProgress(reader('completed'),{type:'vendor',id:1},null);
 const optimized=await repositoryCertificationProgress(reader('completed'),{type:'vendor',id:1},null,{optimized:true,bonusOnly:true});
 expect(optimized.certifications).toEqual(baseline.certifications);
 expect(optimized.bonusScore).toBe(baseline.bonusScore);
 expect(optimized.bonusRequired).toBe(baseline.bonusRequired);
});

it('returns stored progress without executing the source reader',async()=>{
 const source=reader('completed',9,1,false,[],[{id:'document',kind:'document',data:{}}]);
 const saved={...trainingDisplaySummary([]),bonusScore:0,bonusCompleted:0,bonusRequired:0};
 vi.mocked(storedTrainingProjection).mockResolvedValueOnce(saved);
 expect(await repositoryCertificationProgress(source,{type:'vendor',id:1},null,{optimized:true,bonusOnly:true})).toEqual(saved);
 expect(source.select).not.toHaveBeenCalled();
 expect(storedTrainingProjection).toHaveBeenLastCalledWith('vendor:1:progress:company',expect.any(Function));
});

it('precomputes deduplication, grouping, counts and step navigation in the saved display payload',()=>{
 const step=(id:string,complete:boolean)=>({id,type:'course',title:id,href:`/training/${id}`,complete});
 const result=trainingDisplaySummary([
  {id:'shared',title:'Shared',userId:7,standalone:true,complete:true,steps:[step('shared',true)]},
  {id:'bundle',title:'Bundle',userId:7,standalone:false,complete:false,steps:[step('shared',true),step('pending',false)]},
 ]);
 expect(result.overallPercent).toBe(50);
 expect(result.overallTotal).toBe(2);
 expect(result.displayGroups.map(group=>group.title)).toEqual(['Certifications']);
 expect(result.displayGroups[0].items[0]).toMatchObject({completedCount:1,totalCount:2,percent:50,nextStepIndex:1,
  steps:[{ordinal:1,progressState:'completed'},{ordinal:2,progressState:'next'}]});
 expect(result.profileGroups).toEqual([]);
});

it('never reads the prior membership summary for the same person and company',async()=>{
 const source={select:vi.fn()} as any;
 const saved={...trainingDisplaySummary([]),bonusScore:0,bonusCompleted:0,bonusRequired:0};
 storedTrainingProjection.mockImplementationOnce(async(key)=>{
  expect(key).toBe('vendor:1:progress:7:10');
  // Only the old membership exists; a missing new row must not rebuild or fall back.
  throw Object.assign(new Error('Projection pending'),{status:503});
 });
 await expect(repositoryCertificationProgress(source,{type:'vendor',id:1},7,{membershipId:10})).rejects.toMatchObject({status:503});
 expect(source.select).not.toHaveBeenCalled();
 storedTrainingProjection.mockResolvedValueOnce(saved);
 expect(await repositoryCertificationProgress(source,{type:'vendor',id:1},7,{membershipId:11})).toEqual(saved);
 expect(storedTrainingProjection).toHaveBeenLastCalledWith('vendor:1:progress:7:11',expect.any(Function));
 expect(source.select).not.toHaveBeenCalled();
});
it('resolves membership identity only when a caller has not already supplied it',async()=>{
 const source=reader();
 const saved={...trainingDisplaySummary([]),bonusScore:0,bonusCompleted:0,bonusRequired:0};
 storedTrainingProjection.mockResolvedValueOnce(saved);
 expect(await repositoryCertificationProgress(source,{type:'vendor',id:1},7)).toEqual(saved);
 expect(source.select).toHaveBeenCalledOnce();
 expect(storedTrainingProjection).toHaveBeenLastCalledWith('vendor:1:progress:7:9',expect.any(Function));
});
it('refuses to persist a build when its discovered membership has been replaced',async()=>{
 await expect(repositoryCertificationProgress(reader(),{type:'vendor',id:1},7,{membershipId:10})).rejects.toMatchObject({status:409});
});
