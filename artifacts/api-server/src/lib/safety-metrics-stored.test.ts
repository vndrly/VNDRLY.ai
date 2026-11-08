import { beforeEach, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const state = vi.hoisted(() => ({execute:vi.fn(),select:vi.fn()}));
vi.mock('@workspace/db',async original=>({...await original<any>(),db:{execute:state.execute,select:state.select}}));
import { computeSafetyMetrics } from './safety-metrics';
import { buildStoredTrainingProjections,decodeTrainingProjection } from '../work-hub/stored-training-projections';
const dialect = new PgDialect();
const saved={safetyScore:81,daysWithoutRecordable:12,noRecordableMessage:null,openEventCount:3,openHipoCount:1,openRecordableCount:1,formulaExplanation:'Saved formula'};
beforeEach(()=>{
 vi.clearAllMocks();
 state.execute.mockResolvedValue({rows:[{payload:saved}]});
 state.select.mockImplementation(()=>{throw new Error('Request must not scan incident source rows');});
});

it.each([
 [{siteLocationId:5,partnerId:6,vendorId:7},'metrics:site:5'],
 [{partnerId:6,vendorId:7},'metrics:partner:6'],
 [{vendorId:7},'metrics:vendor:7'],
 [{},'metrics:global'],
])('reads stored incident metrics with original scope precedence %j',async(opts,key)=>{
 expect(await computeSafetyMetrics(opts)).toEqual(saved);
 expect(state.select).not.toHaveBeenCalled();
 const query=dialect.sqlToQuery(state.execute.mock.calls[0][0]);
 expect(query.sql).toMatch(/^SELECT payload/);
 expect(query.params).toEqual([key]);
});

it('returns unavailable for a missing saved result without scanning or refreshing',async()=>{
 state.execute.mockResolvedValue({rows:[]});
 await expect(computeSafetyMetrics({vendorId:7})).rejects.toMatchObject({status:503});
 expect(state.select).not.toHaveBeenCalled();
 expect(state.execute).toHaveBeenCalledOnce();
});

it('computes and persists once inside worker context, including duplicate consumers',async()=>{
 const rows:unknown[]=[];
 const query:any={from:()=>query,where:()=>query,orderBy:()=>query,limit:async()=>rows,then:(resolve:any,reject:any)=>Promise.resolve(rows).then(resolve,reject)};
 state.select.mockReturnValue(query);
 state.execute.mockResolvedValue({rows:[]});
 const values=await buildStoredTrainingProjections(()=>Promise.all([computeSafetyMetrics({vendorId:7}),computeSafetyMetrics({vendorId:7})]));
 expect(values[0]).toEqual(values[1]);
 expect(values[0].safetyScore).toBe(100);
 expect(state.select).toHaveBeenCalledTimes(3);
 expect(state.execute).toHaveBeenCalledOnce();
 const write=dialect.sqlToQuery(state.execute.mock.calls[0][0]);
 expect(write.sql).toContain('INSERT INTO training_read_projections');
 expect(write.params[0]).toBe('metrics:vendor:7');
 expect(decodeTrainingProjection(JSON.parse(String(write.params[1])))).toEqual(values[0]);
});
