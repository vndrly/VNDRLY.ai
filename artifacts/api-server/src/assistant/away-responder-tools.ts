import {z} from "zod/v4";
import {WorkHubAwayCommandSchema,WorkHubAwayReadSchema,WorkHubAwayChannelsSchema} from "@workspace/api-zod";
import type {SessionPayload} from "../lib/session";
export const AWAY_RESPONDER_ARGUMENTS=z.discriminatedUnion("action",[
 WorkHubAwayCommandSchema.options[0].omit({operationId:true}),
 WorkHubAwayCommandSchema.options[1].omit({operationId:true}),
]);
export const AWAY_RESPONDER_READ_INPUT=z.object({}).strict();
export const AWAY_RESPONDER_TOOLS=[
 {name:"query_work_hub_away_responder",description:"Read your own current-company saved away rule and revision. An active saved rule does not prove any reply was delivered or read.",inputSchema:z.toJSONSchema(AWAY_RESPONDER_READ_INPUT),outputSchema:z.toJSONSchema(WorkHubAwayReadSchema),securitySchemes:[{type:"oauth2" as const,scopes:["work_hub:read"]}],annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
 {name:"query_work_hub_away_channels",description:"Read your currently joined writable Work Hub conversations available for an explicit away reply rule. This is not a company directory or permission to message other recipients.",inputSchema:z.toJSONSchema(AWAY_RESPONDER_READ_INPUT),outputSchema:z.toJSONSchema(WorkHubAwayChannelsSchema),securitySchemes:[{type:"oauth2" as const,scopes:["work_hub:read"]}],annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
 {name:"manage_work_hub_away_responder",description:"Prepare human approval to configure, pause or revoke your own current-company away responder using the current expectedVersion. Configure requires exact reviewed replyText, UTC startsAt/endsAt and explicitly selected currently joined writable channelIds. During that window, a qualifying incoming Work Hub message may save at most one neutral reply per channel and window. No global reply, email, SMS, invented availability or provider delivery claim. Current account and each channel permission are rechecked.",inputSchema:z.toJSONSchema(AWAY_RESPONDER_ARGUMENTS),securitySchemes:[{type:"oauth2" as const,scopes:["work_hub:write"]}],annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},
] as const;
export function awayResponderAvailable(session:SessionPayload,scopes:readonly string[],write=true){return Boolean(session.userId&&session.activeMembershipId&&session.sv&&(session.role==="partner"?session.partnerId:session.vendorId))&&["vendor","partner","field_employee"].includes(session.role??"")&&scopes.includes(write?"work_hub:write":"work_hub:read");}
export function awayResponderRequest(raw:unknown,operationId:string){return{method:"POST" as const,path:"/work-hub/away-responder",body:WorkHubAwayCommandSchema.parse({...AWAY_RESPONDER_ARGUMENTS.parse(raw),operationId})};}
