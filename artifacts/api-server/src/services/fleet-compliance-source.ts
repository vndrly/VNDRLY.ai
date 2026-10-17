import { FleetComplianceRecordSchema, fleetComplianceSubjectKey, type FleetComplianceIndexEntry, type FleetComplianceRecord } from "@workspace/api-zod";
import type { ObjectStore } from "../lib/objectStore";
import { FleetError } from "./fleet-repository";

/** Internal assessment/reviewer source reader. The caller must already hold
 * current company/subject authority; no HTTP or assistant tool exposes it. */
export async function readFleetPrivateComplianceSource(entry:FleetComplianceIndexEntry,companyId:number,store:ObjectStore,digest:(value:unknown)=>string):Promise<FleetComplianceRecord>{
  try{
    const obj=await store.getObject(entry.objectPath);
    if(!obj||obj.acl?.purpose!=="fleet-compliance-private"||obj.acl.visibility!=="private"||obj.acl.owner!==`fleet-compliance:${companyId}`)throw new Error("Private source unavailable");
    const record=FleetComplianceRecordSchema.parse(JSON.parse(obj.body.toString("utf8")));
    if(entry.objectPath!==`/objects/fleet-compliance-private/${companyId}/${entry.id}/${entry.revision}/${digest(record)}`||record.evidence.id!==entry.id||record.evidence.revision!==entry.revision||fleetComplianceSubjectKey(record.evidence.subject)!==fleetComplianceSubjectKey(entry.subject))throw new Error("Private source integrity changed");
    return record;
  }catch{throw new FleetError("fleet.private_record_unavailable",503);}
}
