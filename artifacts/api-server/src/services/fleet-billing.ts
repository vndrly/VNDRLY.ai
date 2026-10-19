import { z } from "zod/v4";
import {
  FleetBillingUnitSchema,
  FleetFinalizeTicketInputSchema,
  FleetRunBillingInputSchema,
  FleetTicketPlanSchema,
  FleetTicketBillingV2Schema,
  FleetWorkDateSchema,
  FleetRunSchema,
  type FleetRun,
  type FleetTicketPlan,
} from "@workspace/api-zod";
import type { PoolClient } from "pg";
import type { FleetActor } from "./fleet-ops";
import { FleetError, type FleetState } from "./fleet-repository";
import { commercialFingerprint, readFleetTicketPlan } from "./fleet-commercial";
import { SUBMIT_ALLOWED_STATUSES } from "../lib/ticket-lifecycle-coherence";
import { mayPerformFleetAction } from "./fleet-permissions";
import {readLegacyFleetBillingPlan} from "./fleet-billing-context";
import {resolveFleetCommercialAuthority,requireFleetCommercialAuthority,assessFleetActionPolicy,readFleetAuthoritySites,authorityFromFleetRelationship} from "./fleet-commercial-authority";

const openStatuses = [
  "initiated",
  "draft",
  "in_progress",
  "pending_review",
  "kicked_back",
  "completed",
];
export function assertFleetBillingMatch(
  plan: { siteId: number; afeNumber?: string; workDate?: string },
  siteId: number,
  billing: { afeNumber: string; workDate: string },
) {
  if (
    plan.siteId !== siteId ||
    plan.afeNumber !== billing.afeNumber ||
    plan.workDate !== billing.workDate
  )
    throw new FleetError("fleet.billing_ticket_mismatch", 409);
}
function assertBillingTicketOrigin(
  ticket: { site_location_id: number; vendor_id: number; partner_id: number },
  plan: FleetTicketPlan,
) {
  if (
    ticket.site_location_id !== plan.siteId ||
    ticket.vendor_id !== plan.vendorId ||
    ticket.partner_id !== plan.partnerId
  )
    throw new FleetError("fleet.ticket_origin_locked", 409);
}
export function assertFleetTicketFinalizable(
  status: string,
  runs: { status: string }[],
  openCrew: number,
) {
  if (!openStatuses.includes(status))
    throw new FleetError("fleet.ticket_not_submittable", 409);
  if (openCrew) throw new FleetError("fleet.open_crew_sessions", 409);
  if (runs.some((run) => !["completed", "cancelled"].includes(run.status)))
    throw new FleetError("fleet.runs_not_reviewed", 409);
  if (!runs.some((run) => run.status === "completed"))
    throw new FleetError("fleet.no_reviewed_runs", 409);
}
export function canOfficeFinalize(state: FleetState, a: FleetActor) {
  return (
    state.enabled &&
    (a.membershipRole === "admin" ||
      state.grants.some(
        (g) =>
          g.userId === a.userId &&
          g.roles.includes("fleet_manager") &&
          g.financeRead &&
          g.siteIds.some((id) => a.currentSiteIds?.includes(id)),
      ))
  );
}
function canAccessFleetRuns(
  state: FleetState,
  a: FleetActor,
  runs: FleetRun[],
  action: "dispatch" | "view_finance",
) {
  const grant = state.grants.find((g) => g.userId === a.userId);
  // Every linked fleet must remain in the actor's current grant, including historical runs.
  return runs.every(
    (run) =>
      run.companyId === a.companyId &&
      run.siteIds.every(
        (id) => a.currentSiteIds?.includes(id) && grant?.siteIds.includes(id),
      ) &&
      !!grant?.fleetIds.includes(run.fleetId) &&
      state.fleets.some(
        (f) =>
          f.id === run.fleetId &&
          run.siteIds.every((id) => f.siteIds.includes(id)),
      ) &&
      (a.membershipRole === "admin" ||
        mayPerformFleetAction(
          a.userId,
          grant ? { ...grant, companyId: a.companyId } : null,
          {
            companyId: run.companyId,
            fleetId: run.fleetId,
            driverUserId: run.driverUserId,
          },
          action,
        )),
  );
}
export const canFinalizeFleetRuns = (
  state: FleetState,
  a: FleetActor,
  runs: FleetRun[],
) => canAccessFleetRuns(state, a, runs, "view_finance");
async function billingSite(c: PoolClient, a: FleetActor, siteId: number) {
  if (!a.currentSiteIds?.includes(siteId))
    throw new FleetError("fleet.ticket_site_forbidden", 403);
  const site = (
    await c.query(
      "SELECT id,partner_id,afe,status,is_active,fleet_ticket_policy FROM site_locations WHERE id=$1 AND is_active=true AND COALESCE(hidden,false)=false FOR SHARE",
      [siteId],
    )
  ).rows[0];
  if (!site || site.status !== "active")
    throw new FleetError("fleet.site_unavailable", 409);
  return site;
}
async function catalog(
  c: PoolClient,
  a: FleetActor,
  partnerId: number,
  siteId: number,
) {
  const site=(await readFleetAuthoritySites(c,a.companyId,{siteIds:[siteId],activeOnly:true})).find(row=>row.id===siteId);
  if(!site)return [];
  return (
    await c.query(
      "SELECT w.id,w.name,v.unit_price,v.unit,v.currency,COALESCE(NULLIF(btrim(sw.afe),''),btrim(s.afe),'') AS afe_number FROM vendor_work_types v JOIN work_types w ON w.id=v.work_type_id JOIN site_work_assignments sw ON sw.vendor_id=v.vendor_id AND sw.work_type_id=w.id AND sw.site_location_id=$3 JOIN site_locations s ON s.id=sw.site_location_id JOIN partner_vendor_work_type_approvals pw ON pw.partner_id=s.partner_id AND pw.vendor_id=v.vendor_id AND pw.work_type_id=w.id WHERE v.vendor_id=$1 AND (w.partner_id IS NULL OR w.partner_id=$2) AND v.unit IN ('per_job','lump_sum','per_hour','per_day') AND v.currency='USD' AND v.unit_price IS NOT NULL AND v.unit_price>=0 AND v.unit_price<=1000000 ORDER BY w.name",
      [a.companyId, partnerId, siteId],
    )
  ).rows.filter(r=>authorityFromFleetRelationship(site,a.companyId,siteId,r.id).allowed).map((r) => ({
    id: r.id,
    name: r.name,
    unit: FleetBillingUnitSchema.parse(r.unit),
    rateCents: Math.round(Number(r.unit_price) * 100),
    afeNumber: r.afe_number ?? "",
  }));
}
export async function readFleetTicketRuns(
  c: PoolClient,
  a: FleetActor,
  state: FleetState,
  ticketId: number,
) {
  const stored = (
    await c.query(
      "SELECT tool_output FROM (SELECT DISTINCT ON(target_id) target_id,tool_output,id FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-run' ORDER BY target_id,id DESC) latest WHERE tool_output->>'linkedTicketId'=$2",
      [a.companyId, String(ticketId)],
    )
  ).rows;
  const runs = new Map<string, FleetRun>();
  for (const row of stored) {
    const run = FleetRunSchema.parse(row.tool_output);
    runs.set(run.id, run);
  }
  for (const run of state.runs) {
    if (run.linkedTicketId === ticketId) runs.set(run.id, run);
    else runs.delete(run.id);
  }
  return [...runs.values()];
}
export async function attachFleetBilling(
  c: PoolClient,
  a: FleetActor,
  state: FleetState,
  run: FleetRun,
  input: z.infer<typeof FleetRunBillingInputSchema>,
) {
  const siteId = run.stops[0]?.siteId;
  if (run.stops[0]?.kind !== "pickup")
    throw new FleetError("fleet.billing_origin_required", 400);
  const site = await billingSite(c, a, siteId);
  let ticketId: number;
  let billingUnit: z.infer<typeof FleetBillingUnitSchema> = "per_job";
  if (input.mode === "new_ticket") {
    requireFleetCommercialAuthority(await resolveFleetCommercialAuthority(c,a,{
      partnerId:site.partner_id,billingSiteId:siteId,workTypeId:input.workTypeId,
      workDate:input.workDate,purpose:"capture",policyAt:new Date().toISOString(),
    }));
    const service = (await catalog(c, a, site.partner_id, siteId)).find(
      (w) => w.id === input.workTypeId,
    );
    if (!service)
      throw new FleetError("fleet.billing_work_type_unavailable", 409);
    if (service.afeNumber !== input.afeNumber)
      throw new FleetError("fleet.billing_afe_mismatch", 409);
    billingUnit = service.unit;
    // Explicit new/shared billing choices keep a new ticket open for more runs;
    // only a site-owner Singles policy restricts reuse. Legacy commercial defaults are unchanged.
    const plan = FleetTicketPlanSchema.parse({
      billingWorkflow: true,
      billingUnit,
      afeNumber: input.afeNumber,
      workDate: input.workDate,
      version: 1,
      siteId,
      vendorId: a.companyId,
      partnerId: site.partner_id,
      mode: site.fleet_ticket_policy?.mode ?? "batch",
      rateCents: service.rateCents,
      currency: "USD",
      closure: "manual",
      closesAt: null,
      destinations: [],
      createdByUserId: a.userId,
      createdAt: new Date().toISOString(),
    });
    ticketId = (
      await c.query(
        "INSERT INTO tickets(site_location_id,vendor_id,work_type_id,status,lifecycle_state,intake_channel,description,created_by_id,fleet_plan) VALUES($1,$2,$3,'initiated','pending_arrival','office_on_behalf_of_field_employee',$4,$5,$6::jsonb) RETURNING id",
        [
          siteId,
          a.companyId,
          service.id,
          run.title,
          a.userId,
          JSON.stringify(plan),
        ],
      )
    ).rows[0].id;
    await c.query(
      "INSERT INTO ticket_status_history(ticket_id,from_status,to_status,actor_user_id,actor_role,reason) VALUES($1,NULL,'initiated',$2,$3,'Fleet run billing ticket created')",
      [ticketId, a.userId, a.role ?? "vendor"],
    );
  } else {
    ticketId = input.ticketId;
    const ticket = await readFleetTicketPlan(c, a, state, ticketId, true);
    requireFleetCommercialAuthority(await resolveFleetCommercialAuthority(c,a,{
      partnerId:ticket.partner_id,billingSiteId:siteId,workTypeId:ticket.work_type_id,
      workDate:input.workDate,purpose:"capture",policyAt:new Date().toISOString(),
    }));
    const plan = FleetTicketPlanSchema.parse(ticket.fleet_plan);
    assertBillingTicketOrigin(ticket, plan);
    billingUnit = plan.billingUnit ?? "per_job";
    assertFleetBillingMatch(plan, siteId, input);
    if (
      !plan.billingWorkflow ||
      !openStatuses.includes(ticket.status) ||
      plan.closedAt ||
      plan.finalizationOperationId ||
      plan.mode !== "batch" ||
      site.fleet_ticket_policy?.mode === "singles"
    )
      throw new FleetError("fleet.ticket_closed", 409);
    if (
      !canAccessFleetRuns(
        state,
        a,
        await readFleetTicketRuns(c, a, state, ticketId),
        "dispatch",
      )
    )
      throw new FleetError("fleet.dispatch_required", 403);
  }
  run.linkedTicketId = ticketId;
  run.billing = {
    unit: billingUnit,
    afeNumber: input.afeNumber,
    workDate: input.workDate,
    billedLineId: null,
  };
}
export async function recordFleetBillingCharge(
  c: PoolClient,
  a: FleetActor,
  run: FleetRun,
  billingQuantity?: number,
) {
  if (!run.billing || !run.linkedTicketId || run.billing.billedLineId) return;
  const ticket = (
    await c.query(
      "SELECT t.id,t.vendor_id,t.site_location_id,s.partner_id,t.status,t.fleet_plan FROM tickets t JOIN site_locations s ON s.id=t.site_location_id WHERE t.id=$1 AND t.vendor_id=$2 FOR UPDATE OF t",
      [run.linkedTicketId, a.companyId],
    )
  ).rows[0];
  if (!ticket || !openStatuses.includes(ticket.status))
    throw new FleetError("fleet.ticket_closed", 409);
  const plan = await readLegacyFleetBillingPlan(c,a.companyId,ticket.id,ticket.fleet_plan);
  assertBillingTicketOrigin(ticket, plan);
  assertFleetBillingMatch(plan, run.stops[0].siteId, run.billing);
  if (
    !plan.billingWorkflow ||
    plan.vendorId !== a.companyId ||
    plan.partnerId !== ticket.partner_id
  )
    throw new FleetError("fleet.billing_ticket_mismatch", 409);
  const variable =
    plan.billingUnit === "per_hour" || plan.billingUnit === "per_day";
  if (
    variable &&
    (billingQuantity === undefined ||
      !Number.isFinite(billingQuantity) ||
      billingQuantity <= 0 ||
      billingQuantity > 1000000)
  )
    throw new FleetError("fleet.billing_quantity_required", 400);
  if (!variable && billingQuantity !== undefined && billingQuantity !== 1)
    throw new FleetError("fleet.billing_quantity_invalid", 400);
  const quantity = variable ? billingQuantity! : 1;
  if (Math.abs(quantity * 100 - Math.round(quantity * 100)) > 0.000001)
    throw new FleetError("fleet.billing_quantity_invalid", 400);
  const description = `Fleet run ${run.id}`;
  const prior = (
    await c.query(
      "SELECT id FROM ticket_line_items WHERE ticket_id=$1 AND type='other' AND description=$2",
      [ticket.id, description],
    )
  ).rows[0];
  const line =
    prior ??
    (
      await c.query(
        "INSERT INTO ticket_line_items(ticket_id,type,description,quantity,unit_price) VALUES($1,'other',$2,$4,$3) RETURNING id",
        [ticket.id, description, (plan.rateCents / 100).toFixed(2), quantity],
      )
    ).rows[0];
  run.billing.billedLineId = line.id;
  run.billing.quantity = quantity;
}
export async function fleetBillingChargesValid(
  c: PoolClient,
  ticketId: number,
  plan: FleetTicketPlan,
  runs: FleetRun[],
  lock = false,
) {
  const rows = (
    await c.query(
      "SELECT id,type,description,quantity,unit_price FROM ticket_line_items WHERE ticket_id=$1" +
        (lock ? " FOR SHARE" : ""),
      [ticketId],
    )
  ).rows;
  return runs
    .filter((r) => r.status === "completed")
    .every((run) => {
      const line = rows.find((row) => row.id === run.billing?.billedLineId);
      return (
        run.linkedTicketId === ticketId &&
        run.billing?.workDate === plan.workDate &&
        run.billing?.afeNumber === plan.afeNumber &&
        run.stops[0]?.siteId === plan.siteId &&
        !!line &&
        line.type === "other" &&
        line.description === `Fleet run ${run.id}` &&
        Number(line.quantity) ===
          (run.billing?.quantity ??
            (plan.billingUnit === "per_hour" || plan.billingUnit === "per_day"
              ? NaN
              : 1)) &&
        Number(line.unit_price) === plan.rateCents / 100
      );
    });
}
export function createFleetBillingOperations(
  transaction: <T>(
    a: FleetActor,
    work: (s: FleetState, c: PoolClient) => Promise<T>,
  ) => Promise<T>,
) {
  return {
    billingOptions: (a: FleetActor, input: unknown) =>
      transaction(a, async (state, c) => {
        const body = z
          .object({
            siteId: z.coerce.number().int().positive(),
            fleetId: z.uuid().optional(),
            afeNumber: z.string().trim().max(200),
            workDate: FleetWorkDateSchema,
          })
          .strict()
          .parse(input);
        const grant = state.grants.find((g) => g.userId === a.userId);
        if (
          !state.enabled ||
          !grant?.roles.some((r) => r === "dispatcher" || r === "fleet_manager")
        )
          throw new FleetError("fleet.dispatch_required", 403);
        const site = await billingSite(c, a, body.siteId);
        const finance =
          a.membershipRole === "admin" ||
          (!!body.fleetId &&
            !!grant.financeRead &&
            grant.roles.includes("fleet_manager") &&
            grant.fleetIds.includes(body.fleetId) &&
            grant.siteIds.includes(body.siteId) &&
            state.fleets.some(
              (f) => f.id === body.fleetId && f.siteIds.includes(body.siteId),
            ));
        const workTypes = (
          await catalog(c, a, site.partner_id, body.siteId)
        ).map((service) => {
          if (finance) return service;
          const { rateCents: _rate, ...choice } = service;
          return choice;
        });
        const rows = (
          await c.query(
            "SELECT id,status,fleet_plan FROM tickets WHERE vendor_id=$1 AND site_location_id=$2 AND status=ANY($3::text[]) AND (fleet_plan->>'billingWorkflow'='true' OR fleet_plan->>'billingVersion'='2') AND fleet_plan->>'afeNumber'=$4 AND fleet_plan->>'workDate'=$5 ORDER BY id DESC LIMIT 201",
            [
              a.companyId,
              body.siteId,
              openStatuses,
              body.afeNumber,
              body.workDate,
            ],
          )
        ).rows;
        if (rows.length > 200)
          throw new FleetError("fleet.ticket_limit_reached", 409);
        const tickets: {
          id: number;
          ticketNumber: number;
          siteId: number;
          afeNumber: string;
          workDate: string;
          planVersion: number;
        }[] = [];
        for (const t of rows) {
          if(t.fleet_plan?.billingVersion===2){const p=FleetTicketBillingV2Schema.parse(t.fleet_plan);
            if(p.vendorId===a.companyId&&p.partnerId===site.partner_id&&p.billingSiteId===body.siteId&&p.batchingAllowed&&!p.finalizedAt&&!p.finalizationOperationId&&site.fleet_ticket_policy?.mode!=="singles"&&canAccessFleetRuns(state,a,await readFleetTicketRuns(c,a,state,t.id),"dispatch"))tickets.push({id:t.id,ticketNumber:t.id,siteId:p.billingSiteId,afeNumber:p.afeNumber,workDate:p.workDate,planVersion:p.revision});
            continue;
          }
          const p = FleetTicketPlanSchema.parse(t.fleet_plan);
          if (
            site.fleet_ticket_policy?.mode !== "singles" &&
            p.mode === "batch" &&
            !p.closedAt &&
            !p.finalizationOperationId &&
            canAccessFleetRuns(
              state,
              a,
              await readFleetTicketRuns(c, a, state, t.id),
              "dispatch",
            )
          )
            tickets.push({
              id: t.id,
              ticketNumber: t.id,
              siteId: p.siteId,
              afeNumber: p.afeNumber!,
              workDate: p.workDate!,
              planVersion: p.version,
            });
        }
        return {
          workTypes,
          tickets,
          afeRequired: !!site.afe?.trim(),
          siteAfe: site.afe ?? "",
        };
      }),
    finalizeTicket: (a: FleetActor, ticketId: number, input: unknown) =>
      transaction(a, async (state, c) => {
        if (!canOfficeFinalize(state, a))
          throw new FleetError("fleet.finance_required", 403);
        const body = FleetFinalizeTicketInputSchema.parse(input),
          ticket = await readFleetTicketPlan(c, a, state, ticketId, true),
          plan = FleetTicketPlanSchema.parse(ticket.fleet_plan),
          fingerprint = commercialFingerprint(body);
        assertBillingTicketOrigin(ticket, plan);
        const runs = await readFleetTicketRuns(c, a, state, ticketId);
        if (!canFinalizeFleetRuns(state, a, runs))
          throw new FleetError("fleet.finance_required", 403);
        const replay = plan.operations.find((op) => op.id === body.operationId);
        if (replay) {
          if (
            replay.actorUserId !== a.userId ||
            replay.fingerprint !== fingerprint ||
            plan.finalizationOperationId !== body.operationId
          )
            throw new FleetError("fleet.operation_conflict");
          return {
            ticketId,
            status: ticket.status,
            plan,
            operationId: body.operationId,
          };
        }
        if (plan.version !== body.expectedVersion)
          throw new FleetError("fleet.version_conflict");
        if (!plan.billingWorkflow || plan.operations.length >= 100)
          throw new FleetError("fleet.ticket_plan_locked");
        const authority=requireFleetCommercialAuthority(await resolveFleetCommercialAuthority(c,a,{
          partnerId:ticket.partner_id,billingSiteId:ticket.site_location_id,workTypeId:ticket.work_type_id,
          workDate:plan.workDate!,purpose:"office_submit",policyAt:new Date().toISOString(),
        }));
        // Lock crew rows before checking; ticket row lock also serializes new run attachment.
        const open = (
          await c.query(
            "SELECT id FROM ticket_check_ins WHERE ticket_id=$1 AND check_out_at IS NULL FOR UPDATE",
            [ticketId],
          )
        ).rows;
        assertFleetTicketFinalizable(ticket.status, runs, open.length);
        if (
          runs.some((r) => r.status === "completed" && !r.billing?.billedLineId)
        )
          throw new FleetError("fleet.billing_charge_missing");
        if (!(await fleetBillingChargesValid(c, ticketId, plan, runs, true)))
          throw new FleetError("fleet.billing_charge_mismatch");
        let previous = ticket.status;
        if (!SUBMIT_ALLOWED_STATUSES.has(previous)) {
          await c.query(
            "INSERT INTO ticket_status_history(ticket_id,from_status,to_status,actor_user_id,actor_role,reason) VALUES($1,$2,'pending_review',$3,$4,'Fleet office finalized reviewed runs')",
            [ticketId, previous, a.userId, a.role ?? "vendor"],
          );
          previous = "pending_review";
        }
        if (!SUBMIT_ALLOWED_STATUSES.has(previous))
          throw new FleetError("fleet.ticket_not_submittable");
        plan.version++;
        plan.closedAt = new Date().toISOString();
        plan.finalizationOperationId = body.operationId;
        plan.operations.push({
          id: body.operationId,
          actorUserId: a.userId,
          fingerprint,
        });
        const checkpoints=[];
        for(const run of runs.filter(run=>run.status==="completed"))
          checkpoints.push({runId:run.id,compliance:await assessFleetActionPolicy(c,a,{run,action:"office_submit",
            requiredCertifications:state.fleets.find(f=>f.id===run.fleetId)?.requiredCertifications??[],
            policyAt:new Date().toISOString()})});
        await c.query(`INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,tool_input,tool_output,target_type,target_id,result_status)
          VALUES($1,$2,'fleet','typed','canonical','fleet_ticket_compliance','compliance-checkpoint',$3::jsonb,$4::jsonb,'fleet-ticket-compliance',$5,'completed')`,[
          a.userId,a.companyId,JSON.stringify({operationId:body.operationId,ticketId}),
          JSON.stringify({ticketId,authority,checkpoints}),String(ticketId),
        ]);
        await c.query(
          "UPDATE tickets SET status='submitted',lifecycle_state='off_site',closed_at=COALESCE(closed_at,now()),closed_by_id=COALESCE(closed_by_id,$3),updated_at=now(),fleet_plan=$2::jsonb WHERE id=$1",
          [ticketId, JSON.stringify(plan), a.userId],
        );
        await c.query(
          "INSERT INTO ticket_status_history(ticket_id,from_status,to_status,actor_user_id,actor_role,reason) VALUES($1,$2,'submitted',$3,$4,'Fleet office submitted reviewed ticket')",
          [ticketId, previous, a.userId, a.role ?? "vendor"],
        );
        return {
          ticketId,
          status: "submitted",
          plan,
          operationId: body.operationId,
        };
      }),
  };
}
