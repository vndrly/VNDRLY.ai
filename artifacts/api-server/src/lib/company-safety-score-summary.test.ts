import { expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({bonus:3,record:undefined as unknown}));
vi.mock('@workspace/db',async original=>({...await original<any>(),db:{execute:async()=>({rows:state.record?[{record:state.record}]:[]})}}));
vi.mock('../work-hub/repository-certifications',()=>({repositoryCertificationProgress:vi.fn(async()=>({bonusScore:state.bonus}))}));
import {repositoryCertificationProgress} from '../work-hub/repository-certifications';
import {companySafetyScoreSummary} from './company-safety-maturity';
it('does not turn a missing safety assessment into a perfect score',async()=>{
 const summary=await companySafetyScoreSummary({type:'vendor',id:1});
 expect(summary).toEqual({score:3,maximum:110,bonus:3,incomplete:true});
});
it('uses the same maturity projection and company bonus as the safety page',async()=>{
 state.record={version:1,demo:true,assessedAt:'2026-11-03T12:00:00Z',categories:['leadership','hazards','competence','equipment','learning','emergency'].map(id=>({id,level:4,evidence:'Recorded example'}))};
 try{expect(await companySafetyScoreSummary({type:'vendor',id:1})).toEqual({score:103,maximum:110,bonus:3,incomplete:false});}
 finally{state.record=undefined;}
});

it('propagates the isolated optimization without changing the summary',async()=>{
 const owner={type:'vendor' as const,id:1};
 const baseline=await companySafetyScoreSummary(owner);
 const optimized=await companySafetyScoreSummary(owner,{optimized:true});
 expect(optimized).toEqual(baseline);
 expect(repositoryCertificationProgress).toHaveBeenLastCalledWith(expect.anything(),owner,null,{optimized:true,bonusOnly:true});
});
