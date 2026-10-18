import {FLEET_COMMERCIAL_DEFINITIONS,fleetCommercialToolRequest,fleetAuxiliaryToolRequest} from "./fleet-commercial-tools";
import {chatGptActionTools} from "./chatgpt-tool-access";
import {callNaturalVoiceDomainApi} from "./natural-voice-write-tools";
import type {SessionPayload} from "../lib/session";
/** Only recovery reads. The confirmation hash supplies the original operation;
 * no model UUID, fresh mutation or wider consent is accepted. */
export async function recoverFleetCommercialAction(action:{toolName:string;tokenHash:string;arguments:Record<string,unknown>},session:SessionPayload,scopes:string[],request=callNaturalVoiceDomainApi){
 if(!/^[a-f0-9]{64}$/.test(action.tokenHash)||!chatGptActionTools(session,scopes).some(tool=>tool.name===action.toolName))return null;
 const commercial=FLEET_COMMERCIAL_DEFINITIONS.some(row=>row.name===action.toolName),policy=action.toolName==="activate_fleet_compliance_policy";if(!commercial&&!policy)return null;
 try{
  const args={...action.arguments,idempotencyKey:`chatgpt:${action.tokenHash}`},command=commercial?fleetCommercialToolRequest(action.toolName,args):fleetAuxiliaryToolRequest(action.toolName,args);if(!command||"error" in command)return null;
  const operationId=command.body.operationId,path=commercial?"/fleet/work/assistant/result":command.path.replace(/\/activate$/,`/operations/${operationId}`),result=await request(path,"POST",command.body,session) as {verified?:boolean;canonicalApplied?:boolean;operationId?:string;receipt?:{operationId?:string;status?:string}};
  return result?.verified===true&&(commercial?result.operationId===operationId&&(result.canonicalApplied===true||result.canonicalApplied===false&&["denied","needs_reconciliation","retained"].includes(result.receipt?.status??"")):result.receipt?.operationId===operationId)?result:null;
 }catch{return null;}
}
