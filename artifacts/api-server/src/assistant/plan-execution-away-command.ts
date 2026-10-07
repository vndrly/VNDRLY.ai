import {WorkHubAwayReceiptSchema,WorkHubAwayReadbackSchema} from "@workspace/api-zod";
import {planExecutionFingerprint,type PlanExecutionAuthorization,type PlanExecutionStep} from "./plan-execution";
import type {currentPlanExecutionAuthority} from "./plan-execution-authorization";
import type {SessionPayload} from "../lib/session";
import {AWAY_RESPONDER_ARGUMENTS,awayResponderAvailable,awayResponderRequest} from "./away-responder-tools";
import {awayResponderCommandFingerprint} from "../services/work-hub-away-responder";
export function createPlanAwayCommand(deps:{authorize:typeof currentPlanExecutionAuthority;request:(path:string,method:"POST"|"GET",body:unknown,session:SessionPayload)=>Promise<unknown>}){
 return async(authorization:PlanExecutionAuthorization,step:PlanExecutionStep,readback:boolean)=>{
  const approved=authorization.steps.find(value=>value.id===step.id);
  if(!approved||step.adapter!=="away_responder"||step.toolName!=="manage_work_hub_away_responder"||planExecutionFingerprint(approved)!==planExecutionFingerprint(step))throw Error("Away command was not approved");
  const args=AWAY_RESPONDER_ARGUMENTS.parse(step.arguments),before=await deps.authorize(authorization);
  if(!awayResponderAvailable(before.session,before.scopes)||!before.current.availableTools.includes(step.toolName))throw Error("Away command unavailable");
  const command=awayResponderRequest(args,step.operationId);
  const raw=await deps.request(readback?`/work-hub/away-responder/operations/${step.operationId}`:command.path,readback?"GET":"POST",readback?{}:command.body,before.session);
  const after=await deps.authorize(authorization);
  if(!awayResponderAvailable(after.session,after.scopes)||!after.current.availableTools.includes(step.toolName))throw Error("Away command unavailable");
  if(readback){const envelope=WorkHubAwayReadbackSchema.safeParse(raw);if(!envelope.success)return{state:"unknown" as const};if(envelope.data.receipt===null)return{state:"not_found" as const};}
  const parsed=WorkHubAwayReceiptSchema.safeParse(readback?(raw as {receipt:unknown}).receipt:raw);if(!parsed.success)return{state:"unknown" as const};
  const receipt=parsed.data,[type,ownerId]=authorization.requester.organizationKey.split(":"),actor={userId:authorization.requester.userId,owner:{type:type as "vendor"|"partner",id:Number(ownerId)},membershipId:authorization.requester.membershipId,sessionVersion:authorization.requester.sessionVersion};
  const status=args.action==="configure"?"configured":args.action==="pause"?"paused":"revoked";
  if(receipt.operationId!==step.operationId||receipt.fingerprint!==awayResponderCommandFingerprint(command.body,actor)||receipt.rule.userId!==actor.userId||receipt.rule.owner.type!==actor.owner.type||receipt.rule.owner.id!==actor.owner.id||receipt.rule.version!==args.expectedVersion+1||receipt.status!==status||receipt.rule.status!==(args.action==="configure"?"active":status))return{state:"unknown" as const};
  if(args.action==="configure"?(receipt.rule.replyText!==args.replyText||receipt.rule.startsAt!==args.startsAt||receipt.rule.endsAt!==args.endsAt||JSON.stringify(receipt.rule.channelIds)!==JSON.stringify(args.channelIds)):receipt.rule.id!==args.ruleId)return{state:"unknown" as const};
  return{state:"completed" as const,result:{operationId:step.operationId,sourceReferences:[`work-hub:away:rule:${receipt.rule.id}:operation:${step.operationId}`],summary:JSON.stringify({ruleId:receipt.rule.id,version:receipt.rule.version,status:receipt.status,savedAt:receipt.savedAt,providerDeliveryVerified:false,interpretation:"Exact approved own-company away setting saved. No reply delivery or read is established."})}};
 };
}
