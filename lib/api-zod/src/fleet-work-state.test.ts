import {it,expect} from "vitest";
import * as module from "./index";
const uuid=(n:number)=>`22222222-2222-4222-8222-${String(n).padStart(12,"0")}`,at="2026-10-16T18:00:00Z";
const scope={owner:{type:"vendor",id:11},userId:7,membershipId:9,sessionVersion:2,deviceId:"device",provisioningId:uuid(1)};
const note=(n:number,activity=20,dependencies:string[]=[])=>({version:2,operationId:uuid(n),scope,capturedAt:at,timeZone:"America/Chicago",dependencies,kind:"activity.note",payload:{activity:{type:"canonical",kind:"activity",id:uuid(activity),version:1},ticket:{type:"canonical",kind:"ticket",id:123,version:1},notes:`Fact ${n}`}});
const hash=(n:number)=>n.toString(16).padStart(64,"0");
function call(name:string,...args:any[]):any{const fn=(module as any)[name];expect(fn,name).toBeTypeOf("function");return fn(...args);}
function append(state:any,command:any){return call("appendFleetWorkIntent",state,command,hash(Number(command.operationId.slice(-12))));}
const receipt=(command:any,status="applied",extra:any={})=>({version:2,operationId:command.operationId,scope,fingerprint:hash(Number(command.operationId.slice(-12))),status,recordedAt:at,...(status==="applied"||status==="duplicate"?{mappings:[],canonicalReferences:[]}:status==="retry_later"?{reason:"temporarily_unavailable",retryAt:"2026-10-16T18:01:00Z"}:{reason:"closed_ticket",caseId:uuid(99)}),...extra});
it("isolates a conflicted activity while retaining new original facts and allowing another activity to synchronize",()=>{
 let state=call("createFleetWorkState",scope);const a=note(2),b=note(3,21);state=append(append(state,a),b);state=call("applyFleetWorkReceipt",state,receipt(a,"needs_reconciliation"));const original=JSON.stringify(state.entries[0].command);state=append(state,note(4));expect(call("nextFleetWorkBatch",state,at).map((row:any)=>row.operationId)).toEqual([b.operationId]);expect(state.entries).toHaveLength(3);expect(JSON.stringify(state.entries[0].command)).toBe(original);
});
it("lets an explicit office resolution reach its case while the original activity remains conflicted",()=>{
 const original=note(2);let state=append(call("createFleetWorkState",scope),original);state=call("applyFleetWorkReceipt",state,receipt(original,"needs_reconciliation"));
 const resolution={...note(3),kind:"activity.reconcile",payload:{caseId:uuid(99),expectedVersion:1,activity:original.payload.activity,originalTicket:{type:"local",kind:"ticket",id:uuid(30)},reason:"Office preserves the original and explicitly selects the correct open ticket",resolution:{kind:"link_open_ticket",ticket:{type:"canonical",kind:"ticket",id:456,version:1}}}};state=append(state,resolution);expect(call("nextFleetWorkBatch",state,at).map((row:any)=>row.operationId)).toEqual([uuid(3)]);expect(state.entries[0].delivery.state).toBe("needs_reconciliation");
});
it("never resubmits an unknown write outcome before looking up its exact scoped receipt",()=>{
 let state=append(call("createFleetWorkState",scope),note(2));state=call("markFleetWorkSending",state,uuid(2),at);state=call("markFleetWorkOutcomeUnknown",state,uuid(2));expect(call("nextFleetWorkBatch",state,at)).toEqual([]);expect(call("fleetWorkReceiptLookups",state,at)).toEqual([{operationId:uuid(2),scope,fingerprint:hash(2)}]);state=call("applyFleetWorkReceipt",state,receipt(note(2),"duplicate"));expect(call("fleetWorkReceiptLookups",state,at)).toEqual([]);
});
it("looks up retained v1 outcomes before ever sending a migrated action into canonical intake",()=>{
 const command={...note(2),timeZone:"UTC",kind:"activity.legacy_action",payload:{activity:note(2).payload.activity,base:{runId:uuid(20),companyId:11,driverUserId:7,vehicleAssetId:uuid(21),trailerAssetId:null,version:1},ticket:{id:123,version:null,source:"legacy_cached_run_link"},action:{operationId:uuid(2),expectedVersion:1,action:"acknowledge",capturedAt:at},source:"retained_v1",legacyState:"unsynced",legacySessionVersion:2,legacyCaptureZoneSource:"stored_utc_timestamp",legacyCompliance:"not_recorded"}};
 let state=append(call("createFleetWorkState",scope),command);expect(call("nextFleetWorkBatch",state,at)).toEqual([]);expect(call("fleetWorkReceiptLookups",state,at)[0]).toMatchObject({operationId:uuid(2),legacyRead:{activityId:uuid(20),originalAction:command.payload.action}});expect(state.entries[0].delivery.lastAttemptAt).toBeNull();state=call("applyFleetWorkReceiptAbsence",state,{operationId:uuid(2),scope,fingerprint:hash(2),found:false,checkedAt:at});expect(call("nextFleetWorkBatch",state,at)[0].operationId).toBe(uuid(2));
});
it("backs off failed receipt lookups without resubmitting writes or delaying unrelated capture",()=>{
 let state=append(call("createFleetWorkState",scope),note(2));state=call("markFleetWorkSending",state,uuid(2),at);state=call("markFleetWorkOutcomeUnknown",state,uuid(2));state=call("recordFleetWorkLookupFailure",state,uuid(2),at);
 expect(call("fleetWorkReceiptLookups",state,at)).toEqual([]);expect(call("fleetWorkReceiptLookups",state,"2026-10-16T18:10:00Z")).toHaveLength(1);state=append(state,note(3,21));expect(call("nextFleetWorkBatch",state,at).map((row:any)=>row.operationId)).toEqual([uuid(3)]);
 const retry=call("fleetWorkBackoffAt",at,100000,uuid(2));expect(Date.parse(retry)-Date.parse(at)).toBeLessThanOrEqual(301000);expect(retry).toBe(call("fleetWorkBackoffAt",at,100000,uuid(2)));
});
it("does not let a transport bypass a definite retry delay",()=>{
 let state=append(call("createFleetWorkState",scope),note(2));state=call("applyFleetWorkReceipt",state,receipt(note(2),"retry_later"));expect(()=>call("markFleetWorkSending",state,uuid(2),at)).toThrow();
});
it("allows an exact retry only after scoped receipt absence is checked, and refuses to undo an applied result",()=>{
 let state=append(call("createFleetWorkState",scope),note(2));state=call("markFleetWorkSending",state,uuid(2),at);state=call("markFleetWorkOutcomeUnknown",state,uuid(2));
 const absence={operationId:uuid(2),scope,fingerprint:hash(2),found:false,checkedAt:at};expect(()=>call("applyFleetWorkReceiptAbsence",state,{...absence,scope:{...scope,userId:8}})).toThrow();state=call("applyFleetWorkReceiptAbsence",state,absence);expect(call("nextFleetWorkBatch",state,at)).toHaveLength(1);state=call("applyFleetWorkReceipt",state,receipt(note(2)));expect(()=>call("applyFleetWorkReceiptAbsence",state,absence)).toThrow();
});
it("refuses altered operation bodies and changed receipt scopes/fingerprints without mutating original commands",()=>{
 const command=note(2),state=append(call("createFleetWorkState",scope),command),before=JSON.stringify(state);
 expect(()=>append(state,{...command,payload:{...command.payload,notes:"Different original"}})).toThrow();
 expect(()=>call("applyFleetWorkReceipt",state,receipt(command,"applied",{scope:{...scope,owner:{type:"vendor",id:12}}}))).toThrow();expect(()=>call("applyFleetWorkReceipt",state,receipt(command,"applied",{fingerprint:hash(99)}))).toThrow();expect(JSON.stringify(state)).toBe(before);expect(append(state,command).entries).toHaveLength(1);
});
it("waits for explicit dependencies and enforces per-activity order with deterministic retry dates",()=>{
 const a=note(2),b=note(3,20,[uuid(2)]),c=note(4,21);let state=append(append(append(call("createFleetWorkState",scope),b),c),a);
 expect(call("nextFleetWorkBatch",state,at).map((row:any)=>row.operationId)).toEqual([c.operationId]);
 // A later arrival cannot silently move ahead of the original activity sequence.
 expect(call("fleetWorkDependencyProblems",state)).toEqual(expect.arrayContaining([expect.objectContaining({operationId:b.operationId,reason:"activity_order_dependency"})]));
 let ordered=append(append(call("createFleetWorkState",scope),a),b);ordered=call("applyFleetWorkReceipt",ordered,receipt(a,"retry_later"));expect(call("nextFleetWorkBatch",ordered,at)).toEqual([]);expect(call("nextFleetWorkBatch",ordered,"2026-10-16T18:01:00Z").map((row:any)=>row.operationId)).toEqual([a.operationId]);ordered=call("applyFleetWorkReceipt",ordered,receipt(a));expect(call("nextFleetWorkBatch",ordered,at).map((row:any)=>row.operationId)).toEqual([b.operationId]);
});
it("records local to canonical mappings separately and never rewrites original local references",()=>{
 const command={...note(2),payload:{...note(2).payload,ticket:{type:"local",kind:"ticket",id:uuid(30)}}};let state=append(call("createFleetWorkState",scope),command);const local=command.payload.ticket,canonical={type:"canonical",kind:"ticket",id:321,version:1};state=call("applyFleetWorkReceipt",state,receipt(command,"applied",{mappings:[{local,canonical}]}));expect(state.entries[0].command.payload.ticket).toEqual(local);expect(state.mappings).toEqual([{local,canonical}]);expect(()=>call("applyFleetWorkReceipt",state,receipt(command,"duplicate",{mappings:[{local,canonical:{...canonical,id:999}}]}))).toThrow();
});
it("rejects a receipt that tries to bind a local identity absent from the original command",()=>{
 const command=note(2),state=append(call("createFleetWorkState",scope),command);expect(()=>call("applyFleetWorkReceipt",state,receipt(command,"applied",{mappings:[{local:{type:"local",kind:"ticket",id:uuid(88)},canonical:{type:"canonical",kind:"ticket",id:123,version:1}}]}))).toThrow();
});
it("holds unresolved local ticket references and dependency cycles while independent activity work proceeds",()=>{
 const local={...note(2),payload:{...note(2).payload,ticket:{type:"local",kind:"ticket",id:uuid(88)}}};let state=append(append(call("createFleetWorkState",scope),local),note(3,21));expect(call("nextFleetWorkBatch",state,at).map((row:any)=>row.operationId)).toEqual([uuid(3)]);
 state=append(append(append(call("createFleetWorkState",scope),note(4,24,[uuid(5)])),note(5,25,[uuid(4)])),note(6,26));expect(call("nextFleetWorkBatch",state,at).map((row:any)=>row.operationId)).toEqual([uuid(6)]);expect(call("fleetWorkDependencyProblems",state).filter((row:any)=>row.reason==="dependency_cycle")).toHaveLength(2);
});
it("locks pending originals on sign-out without deleting them or allowing another account to append",()=>{
 const state=append(call("createFleetWorkState",scope),note(2)),locked=call("lockFleetWorkScope",state);expect(locked.entries).toEqual(state.entries);expect(call("nextFleetWorkBatch",locked,at)).toEqual([]);expect(()=>append(locked,note(3))).toThrow();expect(()=>append(state,{...note(3),scope:{...scope,sessionVersion:3}})).toThrow();
});
it("refuses a corrupted journal that mixes accounts, duplicates sequence identities or claims sync without a canonical receipt",()=>{
 const state=append(call("createFleetWorkState",scope),note(2)),schema=(module as any).FleetWorkStateSchema;expect(schema).toBeDefined();
 for(const corrupted of [{...state,entries:[{...state.entries[0],command:{...state.entries[0].command,scope:{...scope,userId:8}}}]},{...state,entries:[state.entries[0],state.entries[0]]},{...state,entries:[{...state.entries[0],delivery:{...state.entries[0].delivery,state:"applied",receipt:null}}]}])expect(schema.safeParse(corrupted).success).toBe(false);
});
it("does not expose original journal objects to a transport that resolves or edits its outgoing copy",()=>{
 const state=append(call("createFleetWorkState",scope),note(2)),before=JSON.stringify(state),batch=call("nextFleetWorkBatch",state,at);batch[0].payload.notes="Transport changed its copy";batch[0].scope.owner.id=999;expect(JSON.stringify(state)).toBe(before);
});
it("orders a seeded interleaved workload deterministically and never treats retention floors as eviction limits",()=>{
 let state=call("createFleetWorkState",scope);for(let i=2;i<32;i++)state=append(state,note(i,20+(i%3)));
 const run=(initial:any)=>{let current=initial;const order:string[]=[];while(current.entries.some((entry:any)=>entry.delivery.state!=="applied")){const batch=call("nextFleetWorkBatch",current,at);expect(batch.length).toBeGreaterThan(0);for(const command of batch){order.push(command.operationId);current=call("applyFleetWorkReceipt",current,receipt(command));}}return order;};expect(run(state)).toEqual(run({...state,entries:[...state.entries].reverse()}));
 const entries=Array.from({length:5001},(_,index)=>({...state.entries[0],sequence:index+1,command:note(index+100),fingerprint:hash(index+100)}));const large={...state,entries,mappings:[]};expect(append(large,note(9999)).entries).toHaveLength(5002);expect((module as any).FLEET_WORK_RETENTION_FLOORS).toEqual({days:7,activities:100,events:5000,photos:500});
});
