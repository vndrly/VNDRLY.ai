import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
 role: 'admin', denied: false,
 saved: new Map<string, unknown>(),
 authority: vi.fn(), read: vi.fn(), compute: vi.fn(), database: vi.fn(),
}));
vi.mock('@workspace/db', async original => ({
 ...await original<any>(), db: { select: state.database, execute: state.database },
}));
vi.mock('../work-hub/library-core', () => ({libraryAuthority: async () => {
 state.authority();
 if (state.denied) throw Object.assign(new Error('Forbidden'), {status:403});
 return {owner:{type:'vendor',id:17},member:{role:state.role}};
}}));
vi.mock('../work-hub/stored-training-projections', () => ({
 storedTrainingProjection: async (key:string, _compute:()=>Promise<unknown>) => {
  state.read(key);
  if (!state.saved.has(key)) throw Object.assign(new Error('Projection pending'), {status:503});
  return state.saved.get(key);
 },
}));
vi.mock('../work-hub/repository-certifications', () => ({repositoryCertificationProgress:state.compute}));
vi.mock('./company-required-training', () => ({
 companyRequiredTraining:state.compute,
 trainingCatalog:{curriculum:[],legacy:{entries:[]},common:{rules:[]},additional:{courses:[]},catalog:{services:[],roleRules:{},conditionalRules:{},gapTopics:{}}},
}));
import { companySafetyMaturity, companySafetyScoreSummary } from './company-safety-maturity';
import { companySafetyReadiness } from './company-safety-readiness';
import { safetyTrainingCatalogView } from './safety-training-catalog-view';

const actor = {userId:7,role:'vendor' as const,vendorId:17};
beforeEach(() => {
 vi.clearAllMocks(); state.saved.clear(); state.role='admin'; state.denied=false;
 state.database.mockImplementation(()=>{throw new Error('Request must not scan safety source data');});
 state.compute.mockImplementation(()=>{throw new Error('Request must not calculate training progress');});
});

it('reads saved maturity and score summary without querying or calculating evidence', async () => {
 const maturity={combinedScore:63,bonusScore:3,categories:[]};
 const summary={score:63,maximum:110,bonus:3,incomplete:false};
 state.saved.set('vendor:17:maturity',maturity);
 state.saved.set('vendor:17:safety-summary',summary);
 expect(await companySafetyMaturity(actor)).toEqual(maturity);
 expect(await companySafetyScoreSummary({type:'vendor',id:17})).toEqual(summary);
 expect(state.authority).toHaveBeenCalledOnce();
 expect(state.database).not.toHaveBeenCalled(); expect(state.compute).not.toHaveBeenCalled();
});

it('overlays current management permission without persisting it in shared readiness', async () => {
 const saved={score:72,activePeople:4,asOf:'2026-11-07T00:00:00Z'};
 state.saved.set('vendor:17:readiness',saved);
 expect(await companySafetyReadiness(actor)).toEqual({...saved,canManage:true});
 state.role='member';
 expect(await companySafetyReadiness(actor)).toEqual({...saved,canManage:false});
 expect(saved).not.toHaveProperty('canManage');
 expect(state.database).not.toHaveBeenCalled(); expect(state.compute).not.toHaveBeenCalled();
});

it('uses one saved catalog baseline across query filters without recalculating counts', async () => {
 const courses=[{id:'G99',required:12,completed:7,trainingItemId:'course-99'}];
 state.saved.set('vendor:17:catalog',{provisional:false,services:[],itemIds:{G99:'course-99'},courses});
 expect((await safetyTrainingCatalogView(actor,{search:'pump'})).courses).toEqual(courses);
 expect((await safetyTrainingCatalogView(actor,{familyId:'G99',allServices:true})).courses).toEqual(courses);
 expect(state.read.mock.calls).toEqual([['vendor:17:catalog'],['vendor:17:catalog']]);
 expect(state.database).not.toHaveBeenCalled(); expect(state.compute).not.toHaveBeenCalled();
});

it('propagates a missing projection instead of calculating on demand', async () => {
 await expect(companySafetyMaturity(actor)).rejects.toMatchObject({status:503});
 await expect(companySafetyReadiness(actor)).rejects.toMatchObject({status:503});
 await expect(safetyTrainingCatalogView(actor,{})).rejects.toMatchObject({status:503});
 expect(state.database).not.toHaveBeenCalled(); expect(state.compute).not.toHaveBeenCalled();
});

it('checks current company authority before reading a stored payload', async () => {
 state.denied=true;
 await expect(companySafetyMaturity(actor)).rejects.toMatchObject({status:403});
 await expect(companySafetyReadiness(actor)).rejects.toMatchObject({status:403});
 await expect(safetyTrainingCatalogView(actor,{})).rejects.toMatchObject({status:403});
 expect(state.read).not.toHaveBeenCalled();
});
