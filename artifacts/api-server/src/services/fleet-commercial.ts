import { estimateMapboxDrivingRoute } from "../lib/mapbox-routing";
import {
  canOfficeFinalize,
  canFinalizeFleetRuns,
  fleetBillingChargesValid,
  readFleetTicketRuns,
  assertFleetTicketFinalizable,
} from "./fleet-billing";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod/v4";
import {
  FleetCommercialSettingsSchema,
  FleetDestinationSchema,
  FleetDestinationInputSchema,
  fleetPhysicalStopsMatch,
  FleetTicketPlanSchema,
  FleetTicketBillingV2Schema,
  type FleetRun,
  type FleetTicketPlan,
  type FleetDestination,
  type FleetRoutePlan,
} from "@workspace/api-zod";
import type { PoolClient } from "pg";
import type { FleetActor } from "./fleet-ops";
import { readFleetAuthoritySites } from "./fleet-commercial-authority";
import { FleetError, type FleetState } from "./fleet-repository";
import {sumEffectiveFinancialLines} from "../lib/effective-financial-line";
const terminal = new Set([
  "submitted",
  "approved",
  "awaiting_payment",
  "funds_dispersed",
  "denied",
  "cancelled",
]);
export const commercialFingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function managing(state: FleetState, actor: FleetActor) {
  return (
    state.enabled &&
    (actor.membershipRole === "admin" ||
      state.grants.some(
        (g) =>
          g.userId === actor.userId &&
          g.roles.some((role) =>
            ["dispatcher", "fleet_manager"].includes(role),
          ) &&
          g.siteIds.some((id) => actor.currentSiteIds?.includes(id)) &&
          g.fleetIds.some((id) =>
            state.fleets.some(
              (f) =>
                f.id === id &&
                f.siteIds.some(
                  (site) =>
                    g.siteIds.includes(site) &&
                    actor.currentSiteIds?.includes(site),
                ),
            ),
          ),
      ))
  );
}
/** Company-owned physical places can be prepared before customer billing
 * setup. This does not grant ticket, partner or commercial default authority. */
function managingCompanyLocations(state:FleetState,actor:FleetActor){
 return state.enabled&&(actor.membershipRole==="admin"||state.grants.some(grant=>grant.userId===actor.userId&&grant.roles.some(role=>["dispatcher","fleet_manager"].includes(role))&&grant.fleetIds.some(id=>state.fleets.some(group=>group.id===id))));
}
async function sites(c: PoolClient, a: FleetActor, state: FleetState) {
  const grant=state.grants.find(row=>row.userId===a.userId),poolSites=state.enabled&&grant?.roles.includes("driver")?state.fleets.filter(row=>grant.fleetIds.includes(row.id)).flatMap(row=>row.siteIds):[];
  const ids = a.membershipRole === "admin" ? null : [...new Set([...(a.currentSiteIds??[]),...poolSites])];
  return readFleetAuthoritySites(c, a.companyId, {
    ...(ids ? { siteIds: ids } : {}),
    activeOnly: true,
  });
}
async function settings(c: PoolClient, a: FleetActor) {
  const row = (
    await c.query("SELECT fleet_commercial_settings FROM vendors WHERE id=$1", [
      a.companyId,
    ])
  ).rows[0];
  if (!row) throw new FleetError("fleet.company_not_found", 404);
  return FleetCommercialSettingsSchema.parse(
    row.fleet_commercial_settings ?? {},
  );
}
export async function readFleetTicketPlan(
  c: PoolClient,
  a: FleetActor,
  state: FleetState,
  ticketId: number,
  lock = false,
) {
  const ticket = (
    await c.query(
      "SELECT t.id,t.site_location_id,t.vendor_id,t.work_type_id,s.partner_id,t.status,t.lifecycle_state,t.fleet_plan FROM tickets t JOIN site_locations s ON s.id=t.site_location_id WHERE t.id=$1 AND t.vendor_id=$2" +
        (lock ? " FOR UPDATE OF t" : ""),
      [ticketId, a.companyId],
    )
  ).rows[0];
  if (!ticket) throw new FleetError("fleet.ticket_not_found", 404);
  if (
    !(await sites(c, a, state)).some(
      (site) => site.id === ticket.site_location_id,
    )
  )
    throw new FleetError("fleet.ticket_site_forbidden", 403);
  return ticket;
}
function assertOrigin(ticket: any, plan: FleetTicketPlan) {
  if (
    ticket.site_location_id !== plan.siteId ||
    ticket.vendor_id !== plan.vendorId ||
    ticket.partner_id !== plan.partnerId
  )
    throw new FleetError("fleet.ticket_origin_locked", 409);
}
export async function bindFleetRunTicket(
  c: PoolClient,
  a: FleetActor,
  state: FleetState,
  run: FleetRun,
  ticketId: number,
) {
  if (run.companyId !== a.companyId)
    throw new FleetError("fleet.ticket_company_forbidden", 403);
  const ticket = await readFleetTicketPlan(c, a, state, ticketId, true);
  if (terminal.has(ticket.status))
    throw new FleetError("fleet.ticket_closed", 409);
  if (!ticket.fleet_plan)
    throw new FleetError("fleet.ticket_plan_required", 400);
  const plan = FleetTicketPlanSchema.parse(ticket.fleet_plan);
  assertOrigin(ticket, plan);
  if (plan.billingWorkflow)
    throw new FleetError("fleet.billing_choice_required", 409);
  if (
    plan.closedAt ||
    (plan.closesAt && Date.parse(plan.closesAt) <= Date.now())
  )
    throw new FleetError("fleet.ticket_closed", 409);
  if (
    run.stops[0]?.kind !== "pickup" ||
    run.stops[0].siteId !== plan.siteId ||
    run.siteIds.some((site) => site !== plan.siteId)
  )
    throw new FleetError("fleet.ticket_origin_locked", 409);
  if (
    run.commercial &&
    (run.commercial.ticketId !== ticketId ||
      run.commercial.originSiteId !== plan.siteId)
  )
    throw new FleetError("fleet.ticket_origin_locked", 409);
  if (plan.mode === "singles") {
    const current = state.runs.some(
      (other) => other.id !== run.id && other.linkedTicketId === ticketId,
    );
    const stored =
      (
        await c.query(
          "SELECT 1 FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-run' AND target_id<>$2 AND (tool_output->>'linkedTicketId')::int=$3 LIMIT 1",
          [a.companyId, run.id, ticketId],
        )
      ).rows.length > 0;
    if (current || stored)
      throw new FleetError("fleet.singles_requires_new_ticket", 409);
  }
  if (run.commercial) {
    validateCommercialStops(run);
    return;
  }
  run.linkedTicketId = ticketId;
  run.commercial = {
    ticketId,
    originSiteId: plan.siteId,
    mode: plan.mode,
    rateCents: plan.rateCents,
    currency: plan.currency,
    approvedDestinations: structuredClone(plan.destinations),
    destinationId: null,
    billedLineId: null,
  };
  // A destination stop belongs to the ticket origin for authorization; its physical destination is a separate immutable snapshot.
  run.stops = [
    run.stops[0],
    { id: randomUUID(), siteId: plan.siteId, kind: "delivery", sequence: 1 },
  ];
  if (plan.destinations.length === 1) {
    run.commercial.destinationId = plan.destinations[0].id;
    run.stops[1].destination = structuredClone(plan.destinations[0]);
  }
}
export async function selectFleetRunDestination(
  c: PoolClient,
  a: FleetActor,
  state: FleetState,
  run: FleetRun,
  id?: string,
) {
  if (!run.commercial) return;
  const ticket = await readFleetTicketPlan(
    c,
    a,
    state,
    run.commercial.ticketId,
    true,
  );
  const plan = FleetTicketPlanSchema.parse(ticket.fleet_plan);
  assertOrigin(ticket, plan);
  if (
    terminal.has(ticket.status) ||
    plan.closedAt ||
    (plan.closesAt && Date.parse(plan.closesAt) <= Date.now())
  )
    throw new FleetError("fleet.ticket_closed", 409);
  const chosen = run.commercial.approvedDestinations.find(
    (d) => d.id === (id ?? run.commercial!.destinationId),
  );
  if (!chosen) throw new FleetError("fleet.choose_approved_destination", 400);
  const owner = chosen.ownerType === "vendor" ? "vendors" : "partners";
  const data = (
    await c.query(
      `SELECT fleet_commercial_settings FROM ${owner} WHERE id=$1`,
      [chosen.ownerId],
    )
  ).rows[0];
  const current = FleetCommercialSettingsSchema.parse(
    data?.fleet_commercial_settings ?? {},
  ).destinations.find((d) => d.id === chosen.id);
  if (!current?.active)
    throw new FleetError("fleet.destination_unavailable", 409);
  run.commercial.destinationId = chosen.id;
  const delivery = run.stops.find((stop) => stop.kind === "delivery");
  if (!delivery) throw new FleetError("fleet.approved_delivery_required", 400);
  delivery.destination = structuredClone(chosen);
}
export async function recordFleetRunCharge(
  c: PoolClient,
  a: FleetActor,
  run: FleetRun,
) {
  if (!run.commercial || run.commercial.billedLineId) return;
  if (run.commercial.rateCents === undefined)
    throw new FleetError("fleet.billing_rate_missing", 409);
  const ticket = (
    await c.query(
      "SELECT t.id,t.site_location_id,t.vendor_id,s.partner_id,t.status,t.fleet_plan FROM tickets t JOIN site_locations s ON s.id=t.site_location_id WHERE t.id=$1 AND t.vendor_id=$2 FOR UPDATE OF t",
      [run.commercial.ticketId, a.companyId],
    )
  ).rows[0];
  if (!ticket || terminal.has(ticket.status))
    throw new FleetError("fleet.ticket_closed", 409);
  const plan = FleetTicketPlanSchema.parse(ticket.fleet_plan);
  assertOrigin(ticket, plan);
  if (
    run.companyId !== a.companyId ||
    run.commercial.originSiteId !== plan.siteId
  )
    throw new FleetError("fleet.ticket_origin_locked", 409);
  const description = `Fleet run ${run.id}`;
  const existing = (
    await c.query(
      "SELECT id FROM ticket_line_items WHERE ticket_id=$1 AND type='other' AND description=$2",
      [ticket.id, description],
    )
  ).rows[0];
  const row =
    existing ??
    (
      await c.query(
        "INSERT INTO ticket_line_items(ticket_id,type,description,quantity,unit_price) VALUES($1,'other',$2,1,$3) RETURNING id",
        [ticket.id, description, (run.commercial.rateCents / 100).toFixed(2)],
      )
    ).rows[0];
  run.commercial.billedLineId = row.id;
}
export function validateCommercialStops(run: FleetRun) {
  if (run.routePlan) {
    if (
      !fleetPhysicalStopsMatch(run.routePlan, run.siteIds[0], run.stops) ||
      run.siteIds.some((id) => id !== run.siteIds[0])
    )
      throw new FleetError("fleet.physical_route_mismatch", 409);
    return;
  }
  if (!run.commercial) return;
  if (
    run.siteIds.some((id) => id !== run.commercial!.originSiteId) ||
    run.stops.some((stop) => stop.siteId !== run.commercial!.originSiteId) ||
    run.stops.length !== 2 ||
    run.stops[0].kind !== "pickup" ||
    run.stops[1].kind !== "delivery"
  )
    throw new FleetError("fleet.ticket_origin_locked", 409);
  if (
    run.stops.some(
      (stop) =>
        stop.destination &&
        !run.commercial!.approvedDestinations.some(
          (d) =>
            d.id === stop.destination!.id &&
            JSON.stringify(d) === JSON.stringify(stop.destination),
        ),
    )
  )
    throw new FleetError("fleet.destination_not_approved", 409);
}
export async function assertFleetPhysicalRoute(
  c: PoolClient,
  a: FleetActor,
  state: FleetState,
  run: FleetRun,
  exactRevision = false,
) {
  if (!run.routePlan) return;
  await assertFleetRouteLocations(c,a,state,run.routePlan,exactRevision);
  validateCommercialStops(run);
}
/** Saved transport orders also validate locations without fabricating billing,
 * a driver assignment or an operational execution. */
export async function assertFleetRouteLocations(
  c:PoolClient,a:FleetActor,state:FleetState,route:FleetRoutePlan,exactRevision=false,
) {
  const locations = [
    route.origin,
    ...route.stops.map((stop) => stop.location),
    ...(route.base ? [route.base] : []),
  ];
  const authorized = await sites(c, a, state);
  const owners = new Map<string, FleetDestination[]>();
  for (const reference of locations) {
    if (reference.type !== "canonical")
      throw new FleetError("fleet.route_location_unresolved", 409);
    const saved = reference.location;
    if (
      saved.ownerType === "vendor"
        ? saved.ownerId !== a.companyId
        : !authorized.some((site) => site.partner_id === saved.ownerId)
    )
      throw new FleetError("fleet.destination_unavailable", 403);
    const ownerKey = `${saved.ownerType}:${saved.ownerId}`;
    if (!owners.has(ownerKey)) {
      const table = saved.ownerType === "vendor" ? "vendors" : "partners";
      const row = (
        await c.query(
          `SELECT fleet_commercial_settings FROM ${table} WHERE id=$1 FOR SHARE`,
          [saved.ownerId],
        )
      ).rows[0];
      owners.set(
        ownerKey,
        FleetCommercialSettingsSchema.parse(
          row?.fleet_commercial_settings ?? {},
        ).destinations,
      );
    }
    const current = owners
      .get(ownerKey)!
      .find(
        (location) =>
          location.id === saved.id &&
          location.ownerType === saved.ownerType &&
          location.ownerId === saved.ownerId,
      );
    if (
      !current?.active ||
      (current.permittedCompanyIds?.length &&
        !current.permittedCompanyIds.includes(a.companyId)) ||
      (current.activeFrom && Date.parse(current.activeFrom) > Date.now()) ||
      (current.activeUntil && Date.parse(current.activeUntil) <= Date.now())
    )
      throw new FleetError("fleet.destination_unavailable", 409);
    if (exactRevision && JSON.stringify(current) !== JSON.stringify(saved))
      throw new FleetError("fleet.destination_revision_conflict", 409);
  }
}
const destinationInput = FleetDestinationInputSchema;
export function createFleetCommercialOperations(
  transaction: <T>(
    actor: FleetActor,
    work: (state: FleetState, c: PoolClient) => Promise<T>,
  ) => Promise<T>,
) {
  return {
    closeTicketPlan: (a: FleetActor, ticketId: number, input: unknown) =>
      transaction(a, async (state, c) => {
        if (!managing(state, a))
          throw new FleetError("fleet.dispatch_required", 403);
        const body = z
            .object({ expectedVersion: z.number().int().positive() })
            .strict()
            .parse(input),
          ticket = await readFleetTicketPlan(c, a, state, ticketId, true);
        if (!ticket.fleet_plan)
          throw new FleetError("fleet.ticket_plan_required", 400);
        const plan = FleetTicketPlanSchema.parse(ticket.fleet_plan);
        assertOrigin(ticket, plan);
        if (plan.billingWorkflow)
          throw new FleetError("fleet.office_finalize_required", 409);
        if (plan.closedAt) return plan;
        if (plan.version !== body.expectedVersion)
          throw new FleetError("fleet.version_conflict", 409);
        plan.version++;
        plan.closedAt = new Date().toISOString();
        await c.query("UPDATE tickets SET fleet_plan=$2::jsonb WHERE id=$1", [
          ticketId,
          JSON.stringify(plan),
        ]);
        return plan;
      }),
    mapContext: (a: FleetActor) =>
      transaction(a, async (state, c) => {
        const company = (
          await c.query(
            "SELECT id,name,physical_address AS address,latitude,longitude FROM vendors WHERE id=$1",
            [a.companyId],
          )
        ).rows[0];
        const choices = await sites(c, a, state);
        return {
          company,
          sites: choices.map((s) => ({
            siteId: s.id,
            name: s.name,
            latitude: s.latitude,
            longitude: s.longitude,
          })),
          canManage: managingCompanyLocations(state, a),
        };
      }),
    commercialSettings: (a: FleetActor, siteId?: number) =>
      transaction(a, async (state, c) => {
        const value = await settings(c, a),
          choices = await sites(c, a, state);
        const site = choices.find((s) => s.id === siteId);
        if (siteId && !site)
          throw new FleetError("fleet.site_unavailable", 403);
        const partner = site
          ? (
              await c.query(
                "SELECT fleet_commercial_settings FROM partners WHERE id=$1",
                [site.partner_id],
              )
            ).rows[0]
          : null;
        const shared = FleetCommercialSettingsSchema.parse(
          partner?.fleet_commercial_settings ?? {},
        ).destinations;
        return {
          version: value.version,
          defaultMode: value.defaultMode,
          destinations: [...value.destinations, ...shared],
          sitePolicy: site?.fleet_ticket_policy ?? null,
          canManage: managingCompanyLocations(state, a),
          sites: choices.map((s) => ({ siteId: s.id, name: s.name })),
        };
      }),
    recommendDestinations: async (
      a: FleetActor,
      siteId: number,
      material?: string,
    ) => {
      const snapshot = await transaction(a, async (state, c) => {
        const site = (await sites(c, a, state)).find((s) => s.id === siteId);
        if (!site) throw new FleetError("fleet.site_unavailable", 403);
        const value = await settings(c, a),
          partner = (
            await c.query(
              "SELECT fleet_commercial_settings FROM partners WHERE id=$1",
              [site.partner_id],
            )
          ).rows[0];
        return {
          site,
          destinations: [
            ...value.destinations,
            ...FleetCommercialSettingsSchema.parse(
              partner?.fleet_commercial_settings ?? {},
            ).destinations,
          ],
        };
      });
      const radians = Math.PI / 180;
      const distance = (d: FleetDestination) => {
        const lat = snapshot.site.latitude,
          lng = snapshot.site.longitude;
        if (
          d.latitude === null ||
          d.longitude === null ||
          !Number.isFinite(lat) ||
          !Number.isFinite(lng)
        )
          return null;
        const x =
          Math.sin(((d.latitude - lat) * radians) / 2) ** 2 +
          Math.cos(lat * radians) *
            Math.cos(d.latitude * radians) *
            Math.sin(((d.longitude - lng) * radians) / 2) ** 2;
        return 3958.7613 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
      };
      const eligible = snapshot.destinations
        .filter(
          (d) =>
            d.active &&
            (!material?.trim() ||
              !d.materials.length ||
              d.materials.some(
                (value) =>
                  value.toLowerCase() === material.trim().toLowerCase(),
              )),
        )
        .sort((a, b) => (distance(a) ?? Infinity) - (distance(b) ?? Infinity))
        .slice(0, 5);
      const recommendations = await Promise.all(
        eligible.map(async (destination) => {
          if (
            destination.latitude === null ||
            destination.longitude === null ||
            distance(destination) === null
          )
            return {
              destination,
              distanceMiles: null,
              durationMinutes: null,
              basis: "unavailable",
              availability: "capacity_unconfirmed",
              materialEligibility: "unconfirmed",
            };
          const route = await estimateMapboxDrivingRoute({
            origin: {
              latitude: snapshot.site.latitude,
              longitude: snapshot.site.longitude,
            },
            destination: {
              latitude: destination.latitude,
              longitude: destination.longitude,
            },
          });
          return {
            destination,
            distanceMiles: route.ok
              ? route.distanceMiles
              : distance(destination),
            durationMinutes: route.ok ? route.durationMinutes : null,
            basis: route.ok ? "driving" : "straight_line",
            availability: "capacity_unconfirmed",
            materialEligibility:
              material?.trim() &&
              destination.materials.some(
                (value) =>
                  value.toLowerCase() === material.trim().toLowerCase(),
              )
                ? "matched"
                : "unconfirmed",
          };
        }),
      );
      return {
        recommendations: recommendations.sort(
          (a, b) =>
            (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity),
        ),
      };
    },
    saveDestination: (a: FleetActor, input: unknown) =>
      transaction(a, async (state, c) => {
        if (!managingCompanyLocations(state, a))
          throw new FleetError("fleet.dispatch_required", 403);
        const body = z
            .object({
              operationId: z.uuid(),
              expectedVersion: z.number().int().positive(),
              destination: destinationInput,
            })
            .strict()
            .parse(input),
          value = await settings(c, a),
          fingerprint = commercialFingerprint(body),
          replay = value.operations.find((op) => op.id === body.operationId);
        if (replay) {
          if (
            replay.fingerprint !== fingerprint ||
            replay.actorUserId !== a.userId
          )
            throw new FleetError("fleet.operation_conflict");
          const saved = (
            await c.query(
              "SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-destination-operation' AND target_id=$2 ORDER BY id LIMIT 1",
              [a.companyId, body.operationId],
            )
          ).rows[0]?.tool_output;
          return saved
            ? z
                .object({
                  version: z.number().int().positive(),
                  destination: FleetDestinationSchema,
                })
                .strict()
                .parse(saved)
            : { version: value.version, destinations: value.destinations };
        }
        if (value.version !== body.expectedVersion)
          throw new FleetError("fleet.version_conflict");
        const previous = value.destinations.find(
          (d) => d.id === body.destination.id,
        );
        if (body.destination.id && !previous)
          throw new FleetError("fleet.destination_not_found", 404);
        const duplicate = value.destinations.find(
          (d) =>
            d.id !== body.destination.id &&
            d.name.toLowerCase() === body.destination.name.toLowerCase() &&
            d.address.toLowerCase() === body.destination.address.toLowerCase(),
        );
        if (duplicate) throw new FleetError("fleet.destination_duplicate", 409);
        if (
          (!previous && value.destinations.length >= 500) ||
          value.operations.length >= 1000
        )
          throw new FleetError("fleet.store_capacity_reached");
        const next = FleetDestinationSchema.parse({
          ...body.destination,
          id: previous?.id ?? randomUUID(),
          revision: (previous?.revision ?? 0) + 1,
          ownerType: "vendor",
          ownerId: a.companyId,
        });
        value.destinations = previous
          ? value.destinations.map((d) => (d.id === next.id ? next : d))
          : [...value.destinations, next];
        value.version++;
        value.operations.push({
          id: body.operationId,
          actorUserId: a.userId,
          fingerprint,
        });
        await c.query(
          "UPDATE vendors SET fleet_commercial_settings=$2::jsonb WHERE id=$1",
          [a.companyId, JSON.stringify(value)],
        );
        const receipt = { version: value.version, destination: next };
        await c.query(
          "INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,'fleet','typed','canonical','fleet_destination','save','fleet-destination-operation',$3,$4::jsonb,'completed')",
          [a.userId, a.companyId, body.operationId, JSON.stringify(receipt)],
        );
        return receipt;
      }),
    saveCommercialDefault: (a: FleetActor, input: unknown) =>
      transaction(a, async (state, c) => {
        if (a.membershipRole !== "admin")
          throw new FleetError("fleet.company_admin_required", 403);
        const body = z
            .object({
              expectedVersion: z.number().int().positive(),
              mode: z.enum(["batch", "singles"]),
            })
            .strict()
            .parse(input),
          value = await settings(c, a);
        if (value.version !== body.expectedVersion)
          throw new FleetError("fleet.version_conflict");
        value.defaultMode = body.mode;
        value.version++;
        await c.query(
          "UPDATE vendors SET fleet_commercial_settings=$2::jsonb WHERE id=$1",
          [a.companyId, JSON.stringify(value)],
        );
        return value;
      }),
    ticketPlan: (a: FleetActor, ticketId: number) =>
      transaction(a, async (state, c) => {
        if (!canOfficeFinalize(state, a))
          throw new FleetError("fleet.finance_required", 403);
        const ticket = await readFleetTicketPlan(c, a, state, ticketId);
        if(ticket.fleet_plan?.billingVersion===2){
          const plan=FleetTicketBillingV2Schema.parse(ticket.fleet_plan),runs=await readFleetTicketRuns(c,a,state,ticketId);
          if(plan.vendorId!==a.companyId||plan.partnerId!==ticket.partner_id||plan.billingSiteId!==ticket.site_location_id||!canFinalizeFleetRuns(state,a,runs))throw new FleetError("fleet.finance_required",403);
          const rows=(await c.query("SELECT quantity,unit_price AS \"unitPrice\",fleet_billing_metadata AS \"fleetBillingMetadata\" FROM ticket_line_items WHERE ticket_id=$1",[ticketId])).rows;
          const open=(await c.query("SELECT id FROM ticket_check_ins WHERE ticket_id=$1 AND check_out_at IS NULL",[ticketId])).rows.length;
          let canFinalize=canOfficeFinalize(state,a)&&!plan.finalizedAt&&runs.filter(r=>r.status==="completed").every(r=>r.billingV2?.review.status==="reviewed")&&rows.length>0;
          try{assertFleetTicketFinalizable(ticket.status,runs,open);}catch{canFinalize=false;}
          return {billingVersion:2,ticketId,siteId:ticket.site_location_id,partnerId:ticket.partner_id,status:ticket.status,afeNumber:plan.afeNumber,workDate:plan.workDate,plan:{version:plan.revision,closedAt:plan.finalizedAt,rateCents:undefined},charges:{runs:runs.filter(r=>r.status==="completed").length,total:sumEffectiveFinancialLines(rows).currencyAmount},chargeLines:rows.map(row=>row.fleetBillingMetadata),runs:runs.map(({id,title,status,version})=>({id,title,status,version})),canManage:managing(state,a),canFinalize,finalizationOperationId:plan.finalizationOperationId};
        }
        const plan = ticket.fleet_plan
          ? FleetTicketPlanSchema.parse(ticket.fleet_plan)
          : null;
        const runs = await readFleetTicketRuns(c, a, state, ticketId);
        if (plan?.billingWorkflow && !canFinalizeFleetRuns(state, a, runs))
          throw new FleetError("fleet.finance_required", 403);
        const charges = (
          await c.query(
            "SELECT count(*)::int AS runs,COALESCE(sum(quantity*unit_price),0)::text AS total FROM ticket_line_items WHERE ticket_id=$1 AND type='other' AND description LIKE 'Fleet run %'",
            [ticketId],
          )
        ).rows[0];
        const openCrew = (
          await c.query(
            "SELECT id FROM ticket_check_ins WHERE ticket_id=$1 AND check_out_at IS NULL",
            [ticketId],
          )
        ).rows.length;
        let canFinalize =
          canOfficeFinalize(state, a) &&
          canFinalizeFleetRuns(state, a, runs) &&
          !!plan?.billingWorkflow &&
          (!plan.finalizationOperationId || ticket.status === "kicked_back") &&
          !!runs.length;
        try {
          assertFleetTicketFinalizable(ticket.status, runs, openCrew);
        } catch {
          canFinalize = false;
        }
        if (
          runs.some(
            (r) =>
              r.siteIds.some((id) => !a.currentSiteIds?.includes(id)) ||
              (r.status === "completed" && !r.billing?.billedLineId),
          )
        )
          canFinalize = false;
        if (
          canFinalize &&
          plan &&
          !(await fleetBillingChargesValid(c, ticketId, plan, runs))
        )
          canFinalize = false;
        return {
          ticketId,
          siteId: ticket.site_location_id,
          partnerId: ticket.partner_id,
          plan,
          charges,
          canManage: managing(state, a),
          status: ticket.status,
          afeNumber: plan?.afeNumber ?? null,
          workDate: plan?.workDate ?? null,
          runs: runs.map((run) => ({
            id: run.id,
            title: run.title,
            status: run.status,
            version: run.version,
          })),
          canFinalize,
          finalizationOperationId: plan?.finalizationOperationId ?? null,
        };
      }),
    saveTicketPlan: (a: FleetActor, ticketId: number, input: unknown) =>
      transaction(a, async (state, c) => {
        if (!managing(state, a))
          throw new FleetError("fleet.dispatch_required", 403);
        const body = z
            .object({
              operationId: z.uuid(),
              expectedVersion: z.number().int().nonnegative(),
              mode: z.enum(["batch", "singles"]).optional(),
              rateCents: z.number().int().min(0).max(100000000),
              closure: z.enum(["shift", "day", "manual"]),
              closesAt: z.iso.datetime().nullable(),
              destinationIds: z.array(z.uuid()).min(1).max(30),
            })
            .strict()
            .parse(input),
          ticket = await readFleetTicketPlan(c, a, state, ticketId, true),
          previous = ticket.fleet_plan
            ? FleetTicketPlanSchema.parse(ticket.fleet_plan)
            : null,
          fingerprint = commercialFingerprint(body),
          replay = previous?.operations.find(
            (op) => op.id === body.operationId,
          );
        if (replay) {
          if (
            replay.fingerprint !== fingerprint ||
            replay.actorUserId !== a.userId
          )
            throw new FleetError("fleet.operation_conflict");
          return previous;
        }
        if (
          terminal.has(ticket.status) ||
          previous ||
          !["initiated", "awaiting_acceptance"].includes(ticket.status) ||
          (ticket.lifecycle_state &&
            !["pending_arrival", "off_site"].includes(ticket.lifecycle_state))
        )
          throw new FleetError("fleet.ticket_plan_locked", 409);
        if (body.expectedVersion !== 0)
          throw new FleetError("fleet.version_conflict");
        if (
          body.closure !== "manual" &&
          (!body.closesAt || Date.parse(body.closesAt) <= Date.now())
        )
          throw new FleetError("fleet.ticket_closing_time_required", 400);
        const site = (await sites(c, a, state)).find(
          (s) => s.id === ticket.site_location_id,
        )!;
        const value = await settings(c, a),
          partner = (
            await c.query(
              "SELECT fleet_commercial_settings FROM partners WHERE id=$1",
              [ticket.partner_id],
            )
          ).rows[0],
          directory = [
            ...value.destinations,
            ...FleetCommercialSettingsSchema.parse(
              partner?.fleet_commercial_settings ?? {},
            ).destinations,
          ];
        const destinations = body.destinationIds.map((id) =>
          directory.find((d) => d.id === id && d.active),
        );
        if (
          destinations.some((d) => !d) ||
          new Set(body.destinationIds).size !== body.destinationIds.length
        )
          throw new FleetError("fleet.destination_not_approved", 400);
        const mode =
          site.fleet_ticket_policy?.mode ?? body.mode ?? value.defaultMode;
        const plan = FleetTicketPlanSchema.parse({
          version: 1,
          siteId: ticket.site_location_id,
          vendorId: a.companyId,
          partnerId: ticket.partner_id,
          mode,
          rateCents: body.rateCents,
          currency: "USD",
          closure: body.closure,
          closesAt: body.closesAt,
          destinations,
          closedAt: null,
          createdByUserId: a.userId,
          createdAt: new Date().toISOString(),
          operations: [
            { id: body.operationId, fingerprint, actorUserId: a.userId },
          ],
        });
        await c.query("UPDATE tickets SET fleet_plan=$2::jsonb WHERE id=$1", [
          ticketId,
          JSON.stringify(plan),
        ]);
        return plan;
      }),
  };
}
