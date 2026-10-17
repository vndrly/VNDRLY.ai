import {FleetEvidenceUploadSessionSchema,FleetEvidenceUploadStatusSchema,FleetEvidenceUploadCompletionSchema,FleetEvidencePartReceiptSchema} from "./fleet-evidence-upload";
import {FleetWorkReceiptSchema,type FleetWorkScope} from "./fleet-work";
import type {DurableFleetWorkJournal} from "./fleet-work-journal";
/** Byte retries are independent from new physical facts. Never remove local
 * originals or call uploaded bytes a verified Fleet association. */
export async function synchronizeFleetEvidence(options:{scope:FleetWorkScope;journal:DurableFleetWorkJournal;isCurrent:()=>boolean;http:(path:string,body?:unknown)=>Promise<unknown>;put:(path:string,bytes:Uint8Array,sha256:string)=>Promise<unknown>;read:(id:string,offset:number,length:number)=>Promise<Uint8Array>;hash:(bytes:Uint8Array)=>Promise<string>}){
 const current=()=>{if(!options.isCurrent())throw Error("Original evidence account changed");};
 current();const state=await options.journal.readState();let applied=0,pending=0;
 for(const entry of state.entries.filter(row=>row.delivery.state!=="applied"&&["evidence.stage","compliance.document.stage"].includes(row.command.kind)).slice(0,10)){
  const command=entry.command;if(command.kind!=="evidence.stage"&&command.kind!=="compliance.document.stage")continue;
  try{
   current();const upload=FleetEvidenceUploadSessionSchema.parse(await options.http("/api/fleet/work/evidence/begin",command));
   if(JSON.stringify(upload.scope)!==JSON.stringify(options.scope)||upload.operationId!==command.operationId||upload.fingerprint!==entry.fingerprint||upload.localEvidenceId!==command.payload.evidence.id||upload.byteSize!==command.payload.byteSize||upload.sha256!==command.payload.sha256||upload.contentType!==command.payload.contentType)throw Error("Original evidence upload identity changed");
   const base=`/api/fleet/work/evidence/${upload.id}`;
   const status=FleetEvidenceUploadStatusSchema.parse(await options.http(`${base}/status`,{scope:options.scope}));
   if(status.session.id!==upload.id||status.session.fingerprint!==entry.fingerprint||JSON.stringify(status.session.scope)!==JSON.stringify(options.scope))throw Error("Original evidence status identity changed");
   if(!status.completion){
    for(let partNumber=0;partNumber<upload.partCount;partNumber++){
     current();const offset=partNumber*upload.partSize,length=Math.min(upload.partSize,upload.byteSize-offset),bytes=await options.read(String(command.payload.evidence.id),offset,length),hash=await options.hash(bytes);
     if(bytes.length!==length)throw Error("Retained evidence bytes are incomplete");
     const prior=status.parts.find(part=>part.partNumber===partNumber);
     if(prior){if(prior.sha256!==hash||prior.byteSize!==length)throw Error("Original acknowledged evidence bytes changed");continue;}
     current();const receipt=FleetEvidencePartReceiptSchema.parse(await options.put(`${base}/parts/${partNumber}`,bytes,hash));
     if(receipt.partNumber!==partNumber||receipt.sha256!==hash||receipt.byteSize!==length)throw Error("Evidence part acceptance needs verification");
    }
    current();FleetEvidenceUploadCompletionSchema.parse(await options.http(`${base}/complete`,{scope:options.scope,operationId:command.operationId}));
   }
   // Independently read a server-generated receipt from the persisted private
   // association. A successful PUT or lost complete response is not acceptance.
   current();const receipt=FleetWorkReceiptSchema.parse(await options.http(`${base}/receipt`,{scope:options.scope}));
   if(!["applied","duplicate"].includes(receipt.status)||receipt.operationId!==command.operationId||receipt.fingerprint!==entry.fingerprint)throw Error("Evidence association needs canonical verification");
   await options.journal.applyReceipt(options.scope,receipt);applied++;
  }catch(error){current();pending++;await options.journal.putCache(`evidence-sync:${command.operationId}`,{message:error instanceof Error?error.message:"Evidence outcome needs verification"});}
 }
 return {applied,pending};
}
