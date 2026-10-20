import {z} from "zod/v4";
import {FleetActionInputSchema,FleetLegacyAssignmentSchema,FleetRunSchema,FleetWorkCommandSchema,FleetWorkScopeSchema,type FleetWorkCommand,type FleetWorkScope} from "@workspace/api-zod";
type LegacyCommand=Extract<FleetWorkCommand,{kind:"activity.legacy_action"}>;
export type FleetLegacyMigrationPlan={
 phase:"awaiting_durable_import";originalDocument:string;canDeleteOriginal:false;commands:LegacyCommand[];
 recovery:Array<{sourceIndex:number;reason:"invalid_legacy_record"|"unverified_session"|"missing_cached_run"|"changed_assignment"|"missing_ticket"|"invalid_v2_intent"}>;
};
const oldScope=z.object({userId:z.number().int().positive(),companyId:z.number().int().positive(),membershipId:z.number().int().positive().nullable(),sessionVersion:z.number().int().nonnegative().optional()}).strict();
const oldAction=z.object({sessionVersion:z.number().int().nonnegative().optional(),membershipId:z.number().int().positive().nullable().optional(),runId:z.uuid(),base:FleetLegacyAssignmentSchema,input:FleetActionInputSchema,capturedAt:z.iso.datetime(),state:z.enum(["unsynced","conflict","revoked"]),message:z.string().optional()}).strict();
/** Preparation only. The original private document stays at its old scoped
 * key until B3's actual encrypted transaction + exact readback confirms import.
 * This function never deletes, replays, refreshes, or rebases legacy work. */
export function prepareFleetLegacyMigration(originalDocument:string,rawScope:FleetWorkScope):FleetLegacyMigrationPlan{
 const scope=FleetWorkScopeSchema.parse(rawScope),raw:unknown=JSON.parse(originalDocument);
 // Unknown is confined to this old-format reader. Every proposed executable
 // command below passes the strict versioned command schema before return.
 const envelope=z.object({version:z.literal(1),scope:oldScope,overview:z.unknown().nullable(),cachedAt:z.iso.datetime().nullable(),actions:z.array(z.unknown())}).strict().parse(raw);
 if(scope.owner.type!=="vendor"||scope.owner.id!==envelope.scope.companyId||scope.userId!==envelope.scope.userId||scope.membershipId!==envelope.scope.membershipId||(envelope.scope.sessionVersion!==undefined&&scope.sessionVersion!==envelope.scope.sessionVersion))throw new Error("Legacy original account context differs; originals are retained for recovery");
 const plan:FleetLegacyMigrationPlan={phase:"awaiting_durable_import",originalDocument,canDeleteOriginal:false,commands:[],recovery:[]};
 const cached=z.object({runs:z.array(z.unknown())}).passthrough().safeParse(envelope.overview),runs=cached.success?cached.data.runs.flatMap(value=>{const parsed=FleetRunSchema.safeParse(value);return parsed.success?[parsed.data]:[];}):[];
 envelope.actions.forEach((raw,index)=>{
   const parsed=oldAction.safeParse(raw);
   if(!parsed.success){plan.recovery.push({sourceIndex:index,reason:"invalid_legacy_record"});return;}
   const item=parsed.data;
   if(item.membershipId!==undefined&&item.membershipId!==scope.membershipId){plan.recovery.push({sourceIndex:index,reason:"unverified_session"});return;}
   if(item.sessionVersion===undefined||item.sessionVersion!==scope.sessionVersion){plan.recovery.push({sourceIndex:index,reason:"unverified_session"});return;}
   const run=runs.find(row=>row.id===item.runId);
   if(!run){plan.recovery.push({sourceIndex:index,reason:"missing_cached_run"});return;}
   if(run.companyId!==scope.owner.id||item.base.companyId!==scope.owner.id||run.version!==item.base.version||run.driverUserId!==item.base.driverUserId||run.vehicleAssetId!==item.base.vehicleAssetId||run.trailerAssetId!==item.base.trailerAssetId||item.base.runId!==item.runId){plan.recovery.push({sourceIndex:index,reason:"changed_assignment"});return;}
   if(!run.linkedTicketId){plan.recovery.push({sourceIndex:index,reason:"missing_ticket"});return;}
   const command=FleetWorkCommandSchema.safeParse({version:2,operationId:item.input.operationId,scope,capturedAt:item.capturedAt,timeZone:"UTC",dependencies:plan.commands.filter(c=>c.payload.base.runId===run.id).slice(-1).map(c=>c.operationId),kind:"activity.legacy_action",payload:{activity:{type:"canonical",kind:"activity",id:run.id,version:item.base.version},base:item.base,ticket:{id:run.linkedTicketId,version:null,source:"legacy_cached_run_link"},action:item.input,source:"retained_v1",legacyState:item.state,legacySessionVersion:item.sessionVersion,legacyCaptureZoneSource:"stored_utc_timestamp",legacyCompliance:"not_recorded"}});
   if(!command.success||command.data.kind!=="activity.legacy_action"){plan.recovery.push({sourceIndex:index,reason:"invalid_v2_intent"});return;}
   plan.commands.push(command.data);
 });
 return plan;
}

/** Each source remains independently recoverable. A crash midway through import
 * resumes by its original operation IDs; no legacy key or byte is deleted. */
export async function importFleetLegacyWork(journal:import("@workspace/api-zod").DurableFleetWorkJournal,originalDocument:string,scope:FleetWorkScope,digest:(value:string)=>Promise<string>){
 const plan=prepareFleetLegacyMigration(originalDocument,scope),key=`legacy-original:${await digest(originalDocument)}`,existing=await journal.readCache(key);
 if(existing&&JSON.stringify((existing as {originalDocument:string}).originalDocument)!==JSON.stringify(originalDocument))throw Error("Legacy original changed; recovery required");
 if(!existing)await journal.putCache(key,{originalDocument,recovery:plan.recovery,originalRetained:true});
 for(const command of plan.commands)await journal.append(command);
 const state=await journal.readState();for(const command of plan.commands){const saved=state.entries.find(row=>row.command.operationId===command.operationId);if(!saved||JSON.stringify(saved.command)!==JSON.stringify(command))throw Error("Legacy durable import readback failed; originals retained");}
 const result={imported:plan.commands.length,recovery:plan.recovery,originalRetained:true as const};await journal.putCache(`${key}:verified`,result);return result;
}
