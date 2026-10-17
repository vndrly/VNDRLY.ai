import {FleetCommercialReviewInputSchema,FleetCommercialReviewSchema,FleetQuantityEvidenceSchema,FleetQuantityReviewSchema,FleetChargeSchema,FleetTicketBillingV2Schema,FleetRunSchema} from "@workspace/api-zod";
import {createFleetWorkCanonicalService} from "./fleet-work-canonical";
import type {FleetWorkExecutionContext} from "./fleet-work-repository";
import {FleetError} from "./fleet-repository";
/** Scoped operational report read. Private original scopes/fingerprints and
 * finance-only rate/charge authority never enter a driver's projection. */
export async function readFleetCommercialReview(context:FleetWorkExecutionContext,raw:unknown){
 const input=FleetCommercialReviewInputSchema.parse(raw),{actor,state,client}=context;
 if(!state.runs.some(row=>row.id===input.activityId)){const row=(await client.query("SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-run' AND target_id=$2 ORDER BY id DESC LIMIT 1",[actor.companyId,input.activityId])).rows[0];if(!row)throw new FleetError("fleet.not_found",404);const saved=FleetRunSchema.parse(row.tool_output);if(saved.companyId!==actor.companyId)throw new FleetError("fleet.action_forbidden",403);state.runs.push(saved);}
 const run=await createFleetWorkCanonicalService(context).detail({...actor},input.activityId),grant=state.grants.find(row=>row.userId===actor.userId);
 if(!run.ticketReference)throw new FleetError("fleet.commercial_work_required",409);
 const finance=!!run.billingV2&&grant?.financeRead===true&&grant.roles.some(role=>role==="fleet_manager"||role==="dispatcher");
 const ticket=(await client.query("SELECT id,status,fleet_plan FROM tickets WHERE id=$1 AND vendor_id=$2",[run.ticketReference.id,actor.companyId])).rows[0];if(!ticket)throw new FleetError("fleet.billing_ticket_mismatch",404);
 const plan=FleetTicketBillingV2Schema.parse(ticket.fleet_plan);
 const rows=(await client.query("SELECT id,user_id,tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-work-quantity' AND tool_output->>'activityId'=$2 AND id>$3::bigint AND ($4::boolean OR user_id=$5) ORDER BY id LIMIT $6",[actor.companyId,run.id,input.after??"0",finance,actor.userId,input.limit+1])).rows;
 const page=rows.slice(0,input.limit),ids=page.map(row=>FleetQuantityEvidenceSchema.parse(row.tool_output.evidence).id);
 const reviews=ids.length?(await client.query("SELECT DISTINCT ON(target_id) tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-work-quantity-review' AND target_id=ANY($2::text[]) AND tool_output->>'activityId'=$3 ORDER BY target_id,id DESC",[actor.companyId,ids,run.id])).rows.map(row=>FleetQuantityReviewSchema.parse(row.tool_output)):[];
 const charges=finance?(await client.query("SELECT DISTINCT ON(target_id) tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-reviewed-charge' AND tool_output->>'runId'=$2 ORDER BY target_id,id DESC",[actor.companyId,run.id])).rows.map(row=>FleetChargeSchema.parse(row.tool_output)):[];
 return FleetCommercialReviewSchema.parse({activityId:run.id,activityVersion:run.version,canReview:finance&&!actor.readOnly,ticket:{id:ticket.id,version:plan.revision,status:ticket.status},billing:finance?run.billingV2:null,charges,quantities:page.map(row=>{const value=row.tool_output,evidence=FleetQuantityEvidenceSchema.parse(value.evidence);if(value.scope.owner.type!=="vendor"||value.scope.owner.id!==actor.companyId||value.scope.userId!==row.user_id||evidence.recordedByUserId!==row.user_id||value.ticketId!==ticket.id)throw new FleetError("fleet.quantity_source_unresolved");const review=reviews.find(item=>item.evidenceId===evidence.id)??null;return {evidence,originalActivityVersion:value.activityVersion,capturedAt:value.capturedAt,receivedAt:value.receivedAt,timeZone:value.timeZone,clockStatus:value.clockStatus,review:finance?review:null};}),nextCursor:rows.length>input.limit?String(page.at(-1)!.id):null});
}
