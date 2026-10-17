import { createHash,createHmac } from "node:crypto";
import { FleetComplianceConfigurationSchema,evaluateFleetWorkCompliance,fleetRunAssetIds,fleetComplianceSubjectKey,type FleetRun,type FleetComplianceSubject,type FleetComplianceRecord } from "@workspace/api-zod";
import type { PoolClient } from "pg";
import { getObjectStore,type ObjectStore } from "../lib/objectStore";
import { readFleetPrivateComplianceSource } from "./fleet-compliance-source";

/** Physical/commercial scope, never a phase, login, or mutable label. */
export function fleetComplianceRunScopeFingerprint(run:FleetRun):string{
 return createHash("sha256").update(JSON.stringify({companyId:run.companyId,activityId:run.id,driverUserId:run.driverUserId,assetIds:fleetRunAssetIds(run),route:run.routePlan??null,order:run.runOrder?{id:run.runOrder.id,version:run.runOrder.version}:null,billing:run.billing?{afeNumber:run.billing.afeNumber,workDate:run.billing.workDate}:null,schedule:run.schedule??null,siteIds:run.siteIds})).digest("hex");
}
/** Called only within a canonical authorized activity transaction. Any missing
 * or corrupt private source becomes a red recorded finding, never clearance. */
export async function readFleetRunComplianceCheckpoint(client:PoolClient,companyId:number,run:FleetRun,at:string,options:{store?:()=>ObjectStore;secret?:()=>string}={}){
 if(run.companyId!==companyId)throw new Error("Fleet compliance company mismatch");
 const config=FleetComplianceConfigurationSchema.parse((await client.query("SELECT fleet_compliance_configuration FROM vendors WHERE id=$1 FOR UPDATE",[companyId])).rows[0]?.fleet_compliance_configuration??{version:1,reviewerUserIds:[],entries:[]}),
   assetIds=fleetRunAssetIds(run),subjects:FleetComplianceSubject[]=[{kind:"carrier",id:companyId},{kind:"driver",id:run.driverUserId},{kind:"vehicle",id:run.vehicleAssetId},...assetIds.filter(id=>id!==run.vehicleAssetId).map(id=>({kind:"component" as const,id})),{kind:"trip",id:run.id}],
   keys=new Set(subjects.map(fleetComplianceSubjectKey)),records:FleetComplianceRecord[]=[];
 const digest=(value:unknown)=>{const secret=options.secret?.()??process.env.SESSION_SECRET;if(!secret)throw new Error("Private storage key unavailable");return createHmac("sha256",secret).update(JSON.stringify(value)).digest("hex");};
 for(const entry of config.entries.filter(row=>keys.has(fleetComplianceSubjectKey(row.subject)))){
   try{records.push(await readFleetPrivateComplianceSource(entry,companyId,(options.store??getObjectStore)(),digest));}catch{/* Warn-only: absent/integrity-failed sources remain missing. */}
 }
 const factsFor=(subject:FleetComplianceSubject)=>config.facts.find(row=>fleetComplianceSubjectKey(row.subject)===fleetComplianceSubjectKey(subject)&&Date.parse(row.reviewedAt)<=Date.parse(at)),
   trip=factsFor({kind:"trip",id:run.id}),carrier=factsFor({kind:"carrier",id:companyId}),
   verified=trip?.workScopeFingerprint===fleetComplianceRunScopeFingerprint(run),
   tripFacts=verified?trip!.facts:{},
   started=run.events.find(event=>event.type==="start"),closed=run.events.find(event=>event.type==="submit_closeout"),
   startAt=started?.capturedAt??started?.recordedAt??run.schedule?.plannedStartAt??at,
   proposedEnd=closed?.capturedAt??closed?.recordedAt??run.schedule?.plannedEndAt??null,
   endAt=proposedEnd&&Date.parse(proposedEnd)>Date.parse(startAt)?proposedEnd:null;
 return evaluateFleetWorkCompliance({members:subjects.map(subject=>({subject,facts:{...carrier?.facts,...factsFor(subject)?.facts,...tripFacts}})),requirements:config.requirements,records,at,freshness:"current",
   work:{carrierId:companyId,equipmentIds:assetIds,states:tripFacts.states??null,cargoCode:tripFacts.cargoCode??null,insuredLegalEntity:carrier?.facts.insuredLegalEntity??null,startAt,endAt,verified}});
}
