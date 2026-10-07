import {WorkHubAwayReadSchema,WorkHubAwayChannelsSchema} from "@workspace/api-zod";
import type {currentPlanExecutionAuthority} from "./plan-execution-authorization";
import type {SessionPayload} from "../lib/session";
import {planExecutionFingerprint,planExecutionResultSchema,type PlanExecutionAuthorization,type PlanExecutionStep} from "./plan-execution";
import {AWAY_RESPONDER_READ_INPUT,awayResponderAvailable} from "./away-responder-tools";
export function createPlanAwayRead(deps:{authorize:typeof currentPlanExecutionAuthority;request:(path:string,method:"GET",body:unknown,session:SessionPayload)=>Promise<unknown>}){
 return async(authorization:PlanExecutionAuthorization,step:PlanExecutionStep)=>{
  const channels=step.toolName==="query_work_hub_away_channels";
  if(step.adapter!=="authorized_read"||!channels&&step.toolName!=="query_work_hub_away_responder"||!authorization.steps.some(saved=>planExecutionFingerprint(saved)===planExecutionFingerprint(step)))throw Error("Away read was not approved");
  AWAY_RESPONDER_READ_INPUT.parse(step.arguments);
  const before=await deps.authorize(authorization);
  if(!awayResponderAvailable(before.session,before.scopes,false)||!before.current.availableTools.includes(step.toolName))throw Error("Away read unavailable");
  const raw=await deps.request(channels?"/work-hub/away-responder/channels":"/work-hub/away-responder","GET",{},before.session);
  const after=await deps.authorize(authorization);
  if(!awayResponderAvailable(after.session,after.scopes,false)||!after.current.availableTools.includes(step.toolName))throw Error("Away read unavailable");
  let summary:unknown;
  if(channels){const value=WorkHubAwayChannelsSchema.parse(raw);summary={channels:value.channels.slice(0,20).map(channel=>({...channel,name:channel.name.slice(0,40),nameTruncated:channel.name.length>40})),totalReturnedChannels:value.channels.length,truncated:value.truncated||value.channels.length>20,source:value.source,interpretation:"Current joined writable channels only; no reply was sent."};}
  else{const value=WorkHubAwayReadSchema.parse(raw);if(value.rule&&(value.rule.userId!==authorization.requester.userId||`${value.rule.owner.type}:${value.rule.owner.id}`!==authorization.requester.organizationKey))throw Error("Away rule outside approved scope");summary={...value,interpretation:"Saved own-company away rule only; no reply or delivery is established by this read."};}
  return planExecutionResultSchema.parse({operationId:step.operationId,sourceReferences:[`work-hub:away:${authorization.requester.organizationKey}:user:${authorization.requester.userId}:${channels?"channels":"settings"}`],summary:JSON.stringify(summary)});
 };
}
