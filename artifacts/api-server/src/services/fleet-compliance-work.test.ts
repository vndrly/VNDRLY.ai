import { createHmac } from "node:crypto";
import { it, expect } from "vitest";
import { FleetRunSchema, FleetComplianceRecordSchema, FleetComplianceConfigurationSchema } from "@workspace/api-zod";
import * as module from "./fleet-compliance-work";
import type { PoolClient } from "pg";
import type { ObjectStore } from "../lib/objectStore";
const at="2026-10-16T18:00:00Z",truck="11111111-1111-4111-8111-111111111111",trailer="22222222-2222-4222-8222-222222222222",activity="33333333-3333-4333-8333-333333333333";
const run=()=>FleetRunSchema.parse({id:activity,fleetId:truck,companyId:11,title:"Synthetic activity",driverUserId:7,vehicleAssetId:truck,trailerAssetId:trailer,siteIds:[9],status:"draft",phase:null,version:1,stops:[{id:truck,siteId:9,kind:"delivery",sequence:0}],loads:[],inspections:[],currentStopId:null,visitedStopIds:[],events:[],linkedTicketId:null,allowedActions:[]});
it("binds work-scope review to resources and physical/billing order, but not authentication or activity phase",()=>{
 const digest=(module as any).fleetComplianceRunScopeFingerprint;expect(digest).toBeTypeOf("function");const original=run();
 expect(digest({...original,status:"in_progress",phase:"traveling",version:12})).toBe(digest(original));
 for(const changed of [{...original,driverUserId:8},{...original,trailerAssetId:null},{...original,companyId:12},{...original,siteIds:[10]}])expect(digest(changed)).not.toBe(digest(original));
 const billed={...original,billing:{afeNumber:"AFE-1",workDate:"2026-10-16",quantity:1,billedLineId:null}};
 expect(digest({...billed,billing:{...billed.billing,quantity:10,billedLineId:90}})).toBe(digest(billed));
 expect(digest({...original,schedule:{plannedStartAt:at,plannedEndAt:"2026-10-16T23:00:00Z",timezone:"America/Chicago",recurrence:null}})).not.toBe(digest(original));
});
it("returns safe red assessments for every assigned subject when referenced source storage or current work review is unavailable",async()=>{
 const reader=(module as any).readFleetRunComplianceCheckpoint;expect(reader).toBeTypeOf("function");
 const client={query:async()=>({rows:[{fleet_compliance_configuration:{version:1,reviewerUserIds:[],entries:[]}}]})} as unknown as PoolClient;
 const summaries=await reader(client,11,run(),at);expect(summaries.map((row:any)=>row.subject.kind)).toEqual(["carrier","driver","vehicle","component","trip"]);expect(summaries.every((row:any)=>row.status==="red")).toBe(true);expect(JSON.stringify(summaries)).not.toMatch(/privateDocumentRef|licenseNumber/);
});
it("checks keyed source integrity and prevents a subject's home-state facts from widening current reviewed work",async()=>{
 const reader=(module as any).readFleetRunComplianceCheckpoint,digest=(module as any).fleetComplianceRunScopeFingerprint;expect(reader).toBeTypeOf("function");
 const source=FleetComplianceRecordSchema.parse({evidence:{id:trailer,revision:1,subject:{kind:"driver",id:7},requirementId:"license",requirementVersion:1,status:"verified",validFrom:null,validUntil:"2027-01-01T00:00:00Z",verifiedAt:at,verifiedByUserId:8,source:"PRIVATE-LICENSE",privateDocumentRef:null,restrictions:{states:["OK"]}},attributes:{kind:"driver_license",issuingState:"OK",licenseNumber:"PRIVATE-1234",licenseClass:"A",endorsements:[],restrictions:[],licenseStatus:"active",sourceRecordId:null},retentionClass:"qualification",retainUntil:null,legalHold:false});
 const secret="synthetic-not-a-credential",path=`/objects/fleet-compliance-private/11/${trailer}/1/${createHmac("sha256",secret).update(JSON.stringify(source)).digest("hex")}`,fact=(subject:any,facts:any)=>({subject,version:1,facts,reviewedAt:at,reviewedByUserId:8,sourceKind:"qualified_reviewer",sourceObjectPath:"/objects/fleet-compliance-private/synthetic"});
 const config=FleetComplianceConfigurationSchema.parse({version:1,reviewerUserIds:[8],entries:[{id:trailer,revision:1,subject:source.evidence.subject,requirementId:"license",requirementVersion:1,status:"verified",validFrom:null,validUntil:source.evidence.validUntil,verifiedAt:at,verifiedByUserId:8,attributeKind:"driver_license",objectPath:path,updatedAt:at}],requirements:[{id:"license",version:1,category:"driver_license",label:"License fixture",subjectKinds:["driver"],jurisdiction:"federal",classification:"company",effectiveFrom:"2026-01-01T00:00:00Z",effectiveUntil:null,applicability:{anyOf:[{allOf:[]}]},renewalDays:null,dueSoonDays:30,source:{url:"https://www.ecfr.gov/current/title-49/part-383",section:"Synthetic test",reviewedAt:at,reviewedByUserId:8}}],facts:[fact({kind:"driver",id:7},{state:"OK"}),{...fact({kind:"trip",id:activity},{states:["OK","TX"],cargoCode:"crude"}),workScopeFingerprint:digest(run())}]});
 const client={query:async()=>({rows:[{fleet_compliance_configuration:config}]})} as unknown as PoolClient,store={getObject:async()=>({body:Buffer.from(JSON.stringify(source)),acl:{owner:"fleet-compliance:11",visibility:"private",purpose:"fleet-compliance-private"}})} as unknown as ObjectStore;
 const summaries=await reader(client,11,run(),at,{store:()=>store,secret:()=>secret});expect(summaries.find((row:any)=>row.subject.kind==="driver")).toMatchObject({status:"red",reasons:expect.arrayContaining([expect.objectContaining({reason:"excluded"})])});expect(JSON.stringify(summaries)).not.toMatch(/PRIVATE|sourceObjectPath|licenseNumber/);
 const lost=await reader(client,11,run(),at,{store:()=>store,secret:()=>"different-key"});expect(lost.find((row:any)=>row.subject.kind==="driver").status).toBe("red");
});
