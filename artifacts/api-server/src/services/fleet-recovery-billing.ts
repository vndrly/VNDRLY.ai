import {FleetRunSchema,FleetWorkBillingIntentSchema,type FleetRun,type FleetWorkCommand} from "@workspace/api-zod";
import type {FleetWorkExecutionContext} from "./fleet-work-repository";
import {FleetError} from "./fleet-repository";
export function fleetOriginalBillingIntent(command:FleetWorkCommand,run?:FleetRun){
 if(command.kind==="activity.create")return command.payload.billing;
 if(command.kind!=="activity.action"||command.payload.activity.type!=="canonical"||!run?.billingV2||run.id!==command.payload.activity.id||run.version!==command.payload.activity.version||run.linkedTicketId!==command.payload.ticket.id)throw new FleetError("fleet.recovery_requires_source_review",409);
 const b=run.billingV2;
 return FleetWorkBillingIntentSchema.parse({choice:"existing_ticket",ticket:command.payload.ticket,partnerId:b.context.partnerId,billingSiteId:b.context.billingSiteId,afeNumber:b.context.afeNumber,workDate:b.context.workDate,currency:b.context.currency,serviceId:b.serviceId,agreementReference:b.requestedAgreementReference});
}
/** Caller has independently authorized the actual retained case. Read its exact
 * original revision, never today's replacement's financial/customer context. */
export async function readFleetOriginalBilling(context:FleetWorkExecutionContext,command:FleetWorkCommand){
 if(command.kind==="activity.create")return {billing:command.payload.billing,title:command.payload.title,driverUserId:command.payload.detailSnapshot.detail.driverUserId,fleetId:null};
 if(command.kind!=="activity.action"||command.payload.activity.type!=="canonical")return null;
 const row=(await context.client.query("SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-run' AND target_id=$2 AND tool_output->>'version'=$3 ORDER BY id DESC LIMIT 1",[context.actor.companyId,command.payload.activity.id,String(command.payload.activity.version)])).rows[0];
 if(!row)throw new FleetError("fleet.original_assignment_unverified",409);const run=FleetRunSchema.parse(row.tool_output);
 return {billing:fleetOriginalBillingIntent(command,run),title:run.title,driverUserId:run.driverUserId,fleetId:run.fleetId};
}
