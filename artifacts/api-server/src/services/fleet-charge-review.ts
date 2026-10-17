import {randomUUID} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {FleetChargeSchema,FleetQuantityReviewSchema,FleetRunBillingV2Schema,FleetTicketBillingV2Schema,type FleetRun,type FleetCharge,type FleetWorkCommand} from "@workspace/api-zod";
import {parseExactDecimal,formatExact,roundExact} from "@workspace/db/format";
import type {PoolClient} from "pg";
import type {FleetWorkExecutionContext} from "./fleet-work-repository";
import {FleetError} from "./fleet-repository";
import {calculateFleetCharges,type FleetChargeCalculation,FleetPricingError} from "./fleet-pricing";
import {readRetainedFleetRateAuthority} from "./fleet-rate-authority";
import {readFleetReviewPacket} from "./fleet-review-packet";
import {readFleetTicketRuns,canOfficeFinalize,assertFleetTicketFinalizable} from "./fleet-billing";
import {isFleetBillingV2TicketOpen} from "./fleet-billing-v2";
import {appendFleetRunEvent} from "./fleet-run-events";
import {resolveFleetCommercialAuthority,requireFleetCommercialAuthority,assessFleetActionPolicy,readFleetAuthoritySites} from "./fleet-commercial-authority";
async function office(context:FleetWorkExecutionContext,run?:FleetRun){
 const {actor,state}=context,g=state.grants.find(row=>row.userId===actor.userId);
 if(actor.readOnly||!state.enabled||!g?.financeRead||!g.roles.some(r=>r==="fleet_manager"||r==="dispatcher")||run&&(run.companyId!==actor.companyId||!g.fleetIds.includes(run.fleetId)||!run.siteIds.every(id=>g.siteIds.includes(id))))throw new FleetError("fleet.finance_required",403);
 if(run){const sites=await readFleetAuthoritySites(context.client,actor.companyId,{siteIds:run.siteIds});if(!run.siteIds.every(id=>sites.some(s=>s.id===id)))throw new FleetError("fleet.finance_required",403);}
}
async function parent(context:FleetWorkExecutionContext,id:number){
 const row=(await context.client.query("SELECT t.id,t.vendor_id,s.partner_id,t.site_location_id,t.status,t.fleet_plan FROM tickets t JOIN site_locations s ON s.id=t.site_location_id WHERE t.id=$1 AND t.vendor_id=$2 FOR UPDATE OF t",[id,context.actor.companyId])).rows[0];
 if(!row)throw new FleetError("fleet.billing_ticket_mismatch",404);
 const plan=FleetTicketBillingV2Schema.parse(row.fleet_plan);
 if(plan.vendorId!==context.actor.companyId||plan.partnerId!==row.partner_id||plan.billingSiteId!==row.site_location_id)throw new FleetError("fleet.billing_ticket_mismatch");
 if(!isFleetBillingV2TicketOpen(row.status)||plan.finalizedAt)throw new FleetError("fleet.ticket_closed");
 return {row,plan};
}
async function append(context:FleetWorkExecutionContext,type:string,id:string,value:unknown){await context.client.query("INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,'fleet','typed','canonical','fleet_charge_review','review-record',$3,$4,$5::jsonb,'completed')",[context.actor.userId,context.actor.companyId,type,id,JSON.stringify(value)]);}
export async function readFleetReviewedCharges(client:PoolClient,companyId:number,ticketId?:number){
 const rows=(await client.query("SELECT tool_output FROM (SELECT DISTINCT ON(target_id) tool_output,id,target_id FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-reviewed-charge' ORDER BY target_id,id DESC) latest WHERE ($2::int IS NULL OR (tool_output->>'ticketId')::int=$2)",[companyId,ticketId??null])).rows;
 return rows.map(row=>FleetChargeSchema.parse(row.tool_output));
}
async function saveCharge(context:FleetWorkExecutionContext,charge:FleetCharge){
 const prior=(await context.client.query("SELECT id,fleet_billing_metadata FROM ticket_line_items WHERE ticket_id=$1 AND fleet_billing_metadata->'charge'->>'id'=$2 FOR UPDATE",[charge.ticketId,charge.id])).rows;
 if(prior.length){if(prior.length!==1||!isDeepStrictEqual(prior[0].fleet_billing_metadata,{version:2,charge}))throw new FleetError("fleet.billing_charge_mismatch");return;}
 const q=formatExact(roundExact(parseExactDecimal(charge.quantity),{scale:2,rounding:"half_away_from_zero"})),rate=formatExact(roundExact(parseExactDecimal(charge.unitRate),{scale:2,rounding:"half_away_from_zero"}));
 // Legacy numeric columns are compatibility displays only. D3 always reads the
 // exact reviewed amount and preserves this source on invoice/export copies.
 await context.client.query("INSERT INTO ticket_line_items(ticket_id,type,description,quantity,unit_price,precise_quantity,precise_unit_price,fleet_billing_metadata,taxable_override) VALUES($1,'labor',$2,$3,$4,$5,$6,$7::jsonb,$8)",[charge.ticketId,charge.description,q,rate,charge.quantity,charge.unitRate,JSON.stringify({version:2,charge}),charge.taxTreatment==="reviewed_taxable"?true:charge.taxTreatment==="reviewed_exempt"?false:null]);
 await append(context,"fleet-reviewed-charge",charge.id,charge);
}
async function rate(context:FleetWorkExecutionContext,run:FleetRun){
 const billing=run.billingV2;if(!billing||billing.pricing.mode!=="priced")throw new FleetError("fleet.price_authority_unresolved");
 const {vendorId:_vendor,...billingContext}=billing.context;
 return readRetainedFleetRateAuthority(context.client,context.actor,{billingContext,serviceId:billing.serviceId,workAt:run.events[0].capturedAt??run.events[0].recordedAt,pricing:billing.pricing});
}
export async function reviewFleetActivityCharges(context:FleetWorkExecutionContext,command:Extract<FleetWorkCommand,{kind:"charge.review"}>,run:FleetRun){
 await office(context,run);const p=command.payload,billing=run.billingV2;
 if(!billing||run.version!==p.expectedVersion)throw new FleetError("fleet.version_conflict");
 if(run.status!=="submitted_for_review"||billing.review.status!=="pending")throw new FleetError("fleet.operational_review_required");
 const {plan}=await parent(context,billing.ticketId),pricing=await rate(context,run),reviewedAt=new Date().toISOString();
 const packet=await readFleetReviewPacket(context.client,run);if(!packet.readyForOperationalReview)throw new FleetError("fleet.operational_records_incomplete");
 if(new Set(p.quantityReviews.map(r=>r.evidenceId)).size!==p.quantityReviews.length)throw new FleetError("fleet.quantity_source_unresolved");
 const quantities=[];
 for(const ref of p.quantityReviews){
  const row=(await context.client.query("SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-work-quantity-review' AND target_id=$2 ORDER BY id DESC LIMIT 1",[context.actor.companyId,ref.evidenceId])).rows[0];
  const q=row&&FleetQuantityReviewSchema.parse(row.tool_output);
  if(!q||q.revision!==ref.revision||q.activityId!==run.id||q.ticketId!==billing.ticketId||q.vendorId!==context.actor.companyId||q.decision!=="accept_as_billable"||!q.quantity)throw new FleetError("fleet.quantity_review_version_conflict");
  quantities.push(q.quantity);
 }
 const existing=await readFleetReviewedCharges(context.client,context.actor.companyId),inputs:FleetChargeCalculation[]=[];
 for(const quantity of quantities){
  const input:FleetChargeCalculation={rateCard:pricing.rateCard,scope:{vendorId:billing.context.vendorId,partnerId:billing.context.partnerId,billingSiteId:billing.context.billingSiteId,afeNumber:billing.context.afeNumber,workDate:billing.context.workDate,ticketId:billing.ticketId,runId:run.id,cycleId:quantity.cycleId,serviceId:billing.serviceId,workAt:run.events[0].capturedAt??run.events[0].recordedAt,stage:"run_review",minimumGroupKey:JSON.stringify([billing.context.partnerId,billing.context.billingSiteId,billing.context.afeNumber,billing.context.workDate,billing.serviceId,pricing.rateCard.id])},description:run.title,taxTreatment:p.taxTreatment,quantityEvidence:[quantity],reviewedIntervals:p.intervals.map(i=>({...i,reviewedByUserId:context.actor.userId,reviewedAt})),additionalCharges:p.additionalCharges.map(c=>({...c,approvedByUserId:context.actor.userId,approvedAt:reviewedAt})),existingCharges:existing};
  let calculated:FleetCharge[];try{calculated=calculateFleetCharges(input);}catch(error){if(error instanceof FleetPricingError)throw new FleetError(error.code);throw error;}
  for(const candidate of calculated){const charge=FleetChargeSchema.parse({...candidate,reviewedByUserId:context.actor.userId,reviewedAt});await saveCharge(context,charge);if(!existing.some(c=>c.id===charge.id))existing.push(charge);}
  inputs.push({...input,existingCharges:[]});
 }
 await append(context,"fleet-charge-review-input",run.id,{version:2,runId:run.id,operationId:command.operationId,quantityReviews:p.quantityReviews,inputs});
 const fleetCompliance=await assessFleetActionPolicy(context.client,context.actor,{run,action:"review",policyAt:reviewedAt,requiredCertifications:context.state.fleets.find(f=>f.id===run.fleetId)?.requiredCertifications??[]});
 run.status="completed";run.phase=null;run.version++;run.billingV2=FleetRunBillingV2Schema.parse({...billing,revision:billing.revision+1,review:{status:"reviewed",operationId:command.operationId,reviewedByUserId:context.actor.userId,reviewedAt,chargeRevision:1}});
 appendFleetRunEvent(run,{id:randomUUID(),operationId:command.operationId,type:"review",actorUserId:context.actor.userId,recordedAt:reviewedAt,capturedAt:new Date(command.capturedAt).toISOString(),source:"user_report",details:{decision:"accept",fleetCompliance,originalCapture:{capturedAt:command.capturedAt,timeZone:command.timeZone}}});
 const revised={...plan,revision:plan.revision+1,reviewedChargeIds:existing.filter(c=>c.ticketId===billing.ticketId).map(c=>c.id)};
 await context.client.query("UPDATE tickets SET fleet_plan=$2::jsonb,updated_at=now() WHERE id=$1",[billing.ticketId,JSON.stringify(revised)]);
 return {ticketVersion:revised.revision};
}
export async function finalizeFleetTicketV2(context:FleetWorkExecutionContext,command:Extract<FleetWorkCommand,{kind:"ticket.finalize"}>,ticketId:number){
 await office(context);const {row,plan}=await parent(context,ticketId);if(plan.revision!==command.payload.expectedVersion)throw new FleetError("fleet.version_conflict");
 const runs=await readFleetTicketRuns(context.client,context.actor,context.state,ticketId);for(const run of runs)await office(context,run);
 const crew=(await context.client.query("SELECT id FROM ticket_check_ins WHERE ticket_id=$1 AND check_out_at IS NULL FOR UPDATE",[ticketId])).rows;assertFleetTicketFinalizable(row.status,runs,crew.length);
 let charges=await readFleetReviewedCharges(context.client,context.actor.companyId);const checkpoints=[];
 for(const run of runs.filter(r=>r.status==="completed")){
  if(!run.billingV2||run.billingV2.review.status!=="reviewed")throw new FleetError("fleet.runs_not_reviewed");await rate(context,run);
  const input=(await context.client.query("SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-charge-review-input' AND target_id=$2 ORDER BY id DESC LIMIT 1",[context.actor.companyId,run.id])).rows[0]?.tool_output;
  if(!input||input.operationId!==run.billingV2.review.operationId)throw new FleetError("fleet.billing_charge_missing");
  for(const raw of input.inputs as FleetChargeCalculation[]){
   // Any later source review requires a fresh explicit charge review/adjustment.
   for(const ref of input.quantityReviews as Array<{evidenceId:string;revision:number}>){const latest=(await context.client.query("SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-work-quantity-review' AND target_id=$2 ORDER BY id DESC LIMIT 1",[context.actor.companyId,ref.evidenceId])).rows[0]?.tool_output;if(!latest||latest.revision!==ref.revision||latest.decision!=="accept_as_billable")throw new FleetError("fleet.quantity_review_version_conflict");}
   if(raw.rateCard.minimum?.scope==="day"&&!command.payload.finalizeDayMinimums)throw new FleetError("fleet.day_minimum_finalization_required");
   let calculated:FleetCharge[];try{calculated=calculateFleetCharges({...raw,scope:{...raw.scope,stage:raw.rateCard.minimum?.scope==="day"?"day_finalize":"ticket_finalize"},existingCharges:charges});}catch(error){if(error instanceof FleetPricingError)throw new FleetError(error.code);throw error;}
   for(const candidate of calculated){const saved=charges.find(c=>c.id===candidate.id)??FleetChargeSchema.parse({...candidate,reviewedByUserId:context.actor.userId,reviewedAt:new Date().toISOString()});await saveCharge(context,saved);if(!charges.some(c=>c.id===saved.id))charges.push(saved);}
  }
  requireFleetCommercialAuthority(await resolveFleetCommercialAuthority(context.client,context.actor,{partnerId:plan.partnerId,billingSiteId:plan.billingSiteId,workTypeId:run.billingV2.serviceId,workDate:run.billingV2.context.workDate,purpose:"office_submit",policyAt:new Date().toISOString()}));
  checkpoints.push({runId:run.id,compliance:await assessFleetActionPolicy(context.client,context.actor,{run,action:"office_submit",policyAt:new Date().toISOString(),requiredCertifications:context.state.fleets.find(f=>f.id===run.fleetId)?.requiredCertifications??[]})});
 }
 const actual=charges.filter(c=>c.ticketId===ticketId),lines=(await context.client.query("SELECT fleet_billing_metadata FROM ticket_line_items WHERE ticket_id=$1 FOR UPDATE",[ticketId])).rows;
 if(!actual.length||actual.some(c=>!c.reviewedAt||!c.reviewedByUserId)||lines.length!==actual.length||lines.some(l=>!actual.some(c=>isDeepStrictEqual(l.fleet_billing_metadata,{version:2,charge:c}))))throw new FleetError("fleet.billing_charge_mismatch");
 const finalized=FleetTicketBillingV2Schema.parse({...plan,revision:plan.revision+1,reviewedChargeIds:actual.map(c=>c.id),finalizedAt:new Date().toISOString(),finalizationOperationId:command.operationId});
 await append(context,"fleet-ticket-compliance",String(ticketId),{ticketId,operationId:command.operationId,checkpoints});
 await context.client.query("UPDATE tickets SET status='submitted',lifecycle_state='off_site',closed_at=COALESCE(closed_at,now()),closed_by_id=COALESCE(closed_by_id,$3),fleet_plan=$2::jsonb,updated_at=now() WHERE id=$1",[ticketId,JSON.stringify(finalized),context.actor.userId]);
 await context.client.query("INSERT INTO ticket_status_history(ticket_id,from_status,to_status,actor_user_id,actor_role,reason) VALUES($1,$2,'submitted',$3,$4,'Fleet office explicitly submitted reviewed ticket')",[ticketId,row.status,context.actor.userId,context.actor.role??"vendor"]);
 return {ticketVersion:finalized.revision};
}

export async function adjustFleetReviewedCharge(context:FleetWorkExecutionContext,command:Extract<FleetWorkCommand,{kind:"charge.adjust"}>,run:FleetRun){
 await office(context,run);const {plan}=await parent(context,run.linkedTicketId!);await rate(context,run);
 if(command.payload.ticket.type==="canonical"&&plan.revision!==command.payload.ticket.version)throw new FleetError("fleet.version_conflict");
 const existing=await readFleetReviewedCharges(context.client,context.actor.companyId,run.linkedTicketId!);
 const original=existing.find(c=>c.id===command.payload.chargeId);
 if(!original||original.runId!==run.id||original.revision!==command.payload.expectedRevision||!original.reviewedAt||!run.billingV2||run.billingV2.review.status!=="reviewed")throw new FleetError("fleet.charge_revision_conflict");
 const delta=parseExactDecimal(command.payload.delta);if(delta.coefficient===0n)throw new FleetError("fleet.adjustment_amount_required");
 const charge=FleetChargeSchema.parse({...original,id:command.operationId,revision:1,code:`adjustment:${original.id}`,kind:"adjustment",description:command.payload.reason,quantity:"1",unit:"flat",unitRate:formatExact({...delta,coefficient:delta.coefficient<0n?-delta.coefficient:delta.coefficient}),exactAmount:formatExact(delta),currencyAmount:formatExact(roundExact(delta,{scale:2,rounding:"half_away_from_zero"})),adjustsChargeId:original.id,eligibleChargeIds:[],calculation:undefined,reviewedByUserId:context.actor.userId,reviewedAt:new Date().toISOString()});
 await saveCharge(context,charge);run.version++;run.billingV2={...run.billingV2,revision:run.billingV2.revision+1,review:{...run.billingV2.review,chargeRevision:run.billingV2.review.chargeRevision+1}};
 appendFleetRunEvent(run,{id:randomUUID(),operationId:command.operationId,type:"charge_adjusted",actorUserId:context.actor.userId,recordedAt:charge.reviewedAt!,capturedAt:new Date(command.capturedAt).toISOString(),source:"user_report",details:{chargeId:charge.id,adjustsChargeId:original.id,reason:command.payload.reason}});
 const revision=plan.revision+1;await context.client.query("UPDATE tickets SET fleet_plan=$2::jsonb,updated_at=now() WHERE id=$1",[run.linkedTicketId,JSON.stringify({...plan,revision,reviewedChargeIds:[...new Set([...plan.reviewedChargeIds,charge.id])]})]);
 return {ticketVersion:revision};
}
