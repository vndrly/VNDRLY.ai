import {it,expect} from "vitest";
import * as preview from "./fleet-run-preview";
import type {FleetRun} from "./fleet";
import type {FleetWorkState} from "./fleet-work-state";
it("advances only the original driver's pending local sequence while leaving the canonical run untouched",()=>{
 const snapshot={detail:{id:"detail",version:1,driverUserId:7},carrierOfRecordId:1};
 const run={id:"activity",companyId:1,driverUserId:7,version:2,status:"dispatched",phase:null,currentStopId:null,visitedStopIds:[],loads:[],records:[],inspections:[],stops:[],resourceAssignment:{snapshot}} as unknown as FleetRun;
 const command={scope:{userId:7,owner:{type:"vendor",id:1}},kind:"activity.action",payload:{activity:{id:run.id},baseAssignment:snapshot,action:{action:"acknowledge",expectedVersion:2}}};
 const entries=[{command,sequence:1,delivery:{state:"outcome_unknown"}}] as unknown as FleetWorkState["entries"];
 const result=preview.previewFleetWorkEntries(run,entries,7);expect(result?.expectedVersion).toBe(3);expect(result?.allowedActions).toContain("inspect");expect(run.status).toBe("dispatched");expect(run.version).toBe(2);
 expect(()=>preview.previewFleetWorkEntries(run,entries,8)).toThrow("Original");
 expect(()=>preview.previewFleetWorkEntries({...run,version:9},entries,7)).toThrow("rebase");
 expect(()=>preview.previewFleetWorkEntries(run,[{...entries[0],delivery:{...entries[0].delivery,state:"needs_reconciliation"}}],7)).toThrow("reconciliation");
 expect(()=>preview.previewFleetWorkEntries({...run,resourceAssignment:{...run.resourceAssignment!,snapshot:{...run.resourceAssignment!.snapshot,carrierOfRecordId:99}}},entries,7)).toThrow("assignment");
});
