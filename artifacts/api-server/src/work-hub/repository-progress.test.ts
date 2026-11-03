import { describe, it, expect, vi } from 'vitest';
vi.mock('./library-audience', () => ({ companyLibraryPeople: vi.fn(async () => [{userId:7,membershipId:9}]) }));
import { repositoryCertificationProgress } from './repository-certifications';
const id='11111111-1111-4111-8111-111111111111';
const metadata={kind:'training',seriesId:id,contentVersion:1,state:'published'};
function reader(status='assigned', membershipId=9, version=1) {
 const result:any[]=[[{id,name:'Assigned course',libraryMetadata:metadata}], [{instance:{id:'assignment',templateId:id,assigneeUserId:7,assignmentMetadata:{assignmentId:id,sourceItemId:id,contentVersion:version,membershipId,status,assignedAt:'2026-11-01T00:00:00Z',dueAt:'2026-12-01T00:00:00Z'}},submission:status==='completed'?new Date():null}], []];
 return { select:vi.fn(()=>{const value=result.shift(); const chain:any={from:()=>chain,where:()=>chain,innerJoin:()=>chain,leftJoin:()=>chain,orderBy:()=>chain,then:(resolve:any)=>Promise.resolve(value).then(resolve)};return chain;}) } as any;
}
describe('direct assigned training progress',()=>{
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
