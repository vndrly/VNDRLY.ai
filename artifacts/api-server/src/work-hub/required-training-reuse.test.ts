import {it,expect,vi,beforeEach} from 'vitest';
const mocks=vi.hoisted(()=>({plan:vi.fn(),allocate:vi.fn(async()=>({assigned:['new']})),lock:vi.fn()}));
vi.mock('../lib/company-required-training',()=>({companyRequiredTraining:mocks.plan}));
vi.mock('./library-assignments',()=>({allocateLibraryItems:mocks.allocate}));
vi.mock('./training-course-policy',()=>({lockCompanyTraining:mocks.lock}));
import {ensureRequiredTraining} from './required-training';
const id='11111111-1111-4111-8111-111111111111';
function tx(status='assigned',membershipId=9,contentVersion=1){const rows=[{templateId:id,userId:7,metadata:{assignmentId:id,sourceItemId:id,contentVersion,membershipId,status,assignedAt:'2026-11-01T00:00:00Z',dueAt:'2026-12-01T00:00:00Z'}}];const chain:any={from:()=>chain,innerJoin:()=>chain,where:()=>Promise.resolve(rows)};return{select:vi.fn(()=>chain)} as any;}
beforeEach(()=>{vi.clearAllMocks();mocks.plan.mockResolvedValue({items:new Map([[id,{record:{id},metadata:{contentVersion:1,content:{dueHours:24}}}]]),requirements:[{itemId:id,userId:7,membershipId:9,completed:false}],audience:[{userId:7,membershipId:9,role:'admin'}]});});
it('reuses active current assignments without a per-course allocation round trip',async()=>{const t=tx();expect(await ensureRequiredTraining(t,{type:'vendor',id:1},7)).toBe(0);expect(t.select).toHaveBeenCalledTimes(1);expect(mocks.allocate).not.toHaveBeenCalled();expect(mocks.lock).toHaveBeenCalled();});
it.each([['cancelled',9,1],['assigned',10,1],['assigned',9,2]])('still allocates for cancelled or stale membership/revision: %s %s %s',async(status,membership,version)=>{expect(await ensureRequiredTraining(tx(status,membership as number,version as number),{type:'vendor',id:1},7)).toBe(1);expect(mocks.allocate).toHaveBeenCalledTimes(1);});
