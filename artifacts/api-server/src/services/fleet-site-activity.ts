import {
  FleetRunSchema,
  FleetSiteActivityFilterSchema,
  type FleetSiteActivity,
  type FleetSiteChoices,
  type FleetRun,
} from "@workspace/api-zod";
import { ACTIVE_APPROVAL_STATUSES } from "@workspace/db";
import type { Pool, PoolClient } from "pg";
import { FleetError } from "./fleet-repository";
export type FleetSiteActor = {
  userId: number;
  partnerId: number;
  sv: number;
  activeMembershipId: number;
  membershipRole: string;
  role: "partner";
};
export function projectFleetSiteRun(
  run: FleetRun,
  siteId: number,
  vendorName: string,
): FleetSiteActivity["records"][number] {
  const stops = run.stops.filter((s) => s.siteId === siteId),
    ids = new Set(stops.map((s) => s.id));
  return {
    runId: run.id,
    vendorName,
    status: run.status,
    stops: stops.map((stop) => ({
      stopId: stop.id,
      kind: stop.kind,
      events: run.events
        .filter(
          (e) =>
            e.details?.stopId === stop.id &&
            ["arrive_stop", "depart_stop", "gate_linked"].includes(e.type),
        )
        .map((e) => ({
          type: e.type,
          recordedAt: e.recordedAt,
          capturedAt: e.capturedAt ?? null,
          source: "user_report",
        })),
    })),
    loads: run.loads
      .filter(
        (load) =>
          ids.has(load.pickupStopId) ||
          (load.deliveryStopId !== null && ids.has(load.deliveryStopId)),
      )
      .map((load) => ({
        loadId: load.id,
        commodity: load.commodity,
        quantity: load.quantity,
        unit: load.unit,
        direction: ids.has(load.pickupStopId)
          ? load.deliveryStopId && ids.has(load.deliveryStopId)
            ? "pickup_and_delivery"
            : "pickup"
          : "delivery",
        delivered: Boolean(
          load.deliveryStopId &&
          ids.has(load.deliveryStopId) &&
          load.deliveredAt,
        ),
      })),
  };
}
export function createFleetSiteActivityService(
  pool: Pick<Pool, "connect">,
  clock: () => Date = () => new Date(),
) {
  const transaction = async <T>(
    actor: FleetSiteActor,
    operation: (client: PoolClient) => Promise<T>,
  ) => {
    if (
      actor.role !== "partner" ||
      ![actor.userId, actor.partnerId, actor.activeMembershipId].every(
        (id) => Number.isInteger(id) && id > 0,
      ) ||
      !Number.isInteger(actor.sv) ||
      actor.sv < 0 ||
      !["member", "admin"].includes(actor.membershipRole)
    )
      throw new FleetError("fleet.site_authority_required", 403);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const user = await client.query(
        "SELECT u.id FROM users u JOIN user_org_memberships m ON m.user_id=u.id WHERE u.id=$1 AND u.session_version=$2 AND u.suspended_at IS NULL AND m.id=$3 AND m.org_type='partner' AND m.partner_id=$4 AND m.role=$5 FOR SHARE OF u,m",
        [
          actor.userId,
          actor.sv,
          actor.activeMembershipId,
          actor.partnerId,
          actor.membershipRole,
        ],
      );
      if (!user.rows.length)
        throw new FleetError("fleet.current_session_required", 403);
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };
  return {
    sites: (actor: FleetSiteActor): Promise<FleetSiteChoices> =>
      transaction(actor, async (client) => {
        const found = await client.query(
          "SELECT s.id,s.name FROM site_locations s WHERE s.partner_id=$1 AND COALESCE(s.hidden,false)=false AND EXISTS(SELECT 1 FROM partner_vendor_relationships r JOIN vendors v ON v.id=r.vendor_id WHERE r.partner_id=s.partner_id AND r.status=ANY($2::text[]) AND v.fleet_ops_state->>'enabled'='true') ORDER BY s.name LIMIT 201",
          [actor.partnerId, [...ACTIVE_APPROVAL_STATUSES]],
        );
        if (found.rows.length > 200)
          throw new FleetError("fleet.site_limit_reached", 409);
        return {
          sites: found.rows.map((row) => ({ siteId: row.id, name: row.name })),
          capabilities: {
            canReadSiteActivity: true,
            canDispatch: false,
            canDrive: false,
          },
        };
      }),
    activity: (
      actor: FleetSiteActor,
      siteId: number,
      input: unknown,
    ): Promise<FleetSiteActivity> => {
      const filter = FleetSiteActivityFilterSchema.parse(input);
      if (!Number.isInteger(siteId) || siteId < 1)
        throw new FleetError("fleet.invalid_site", 400);
      const endsAt = filter.endsAt ?? clock().toISOString(),
        startsAt =
          filter.startsAt ??
          new Date(Date.parse(endsAt) - 30 * 86400000).toISOString();
      if (
        Date.parse(endsAt) <= Date.parse(startsAt) ||
        Date.parse(endsAt) - Date.parse(startsAt) > 90 * 86400000
      )
        throw new FleetError("fleet.site_window_invalid", 400);
      return transaction(actor, async (client) => {
        const site = await client.query(
          "SELECT id,name FROM site_locations WHERE id=$1 AND partner_id=$2 AND COALESCE(hidden,false)=false FOR SHARE",
          [siteId, actor.partnerId],
        );
        if (!site.rows.length)
          throw new FleetError("fleet.site_not_found", 404);
        const companies = await client.query(
          "SELECT v.id,v.name,v.fleet_ops_state FROM vendors v JOIN partner_vendor_relationships r ON r.vendor_id=v.id WHERE r.partner_id=$1 AND r.status=ANY($2::text[]) AND v.fleet_ops_state->>'enabled'='true' ORDER BY v.id LIMIT 201 FOR SHARE OF v,r",
          [actor.partnerId, [...ACTIVE_APPROVAL_STATUSES]],
        );
        if(companies.rows.length>200)throw new FleetError("fleet.site_company_capacity_reached",409);
        const companyIds = companies.rows.map((row) => row.id);
        const saved = await client.query(
          "SELECT vendor_id,tool_output FROM (SELECT DISTINCT ON(vendor_id,target_id) vendor_id,tool_output,target_id,id FROM assistant_action_audit WHERE target_type='fleet-run' AND vendor_id=ANY($1::int[]) ORDER BY vendor_id,target_id,id DESC) latest WHERE tool_output->'siteIds' @> jsonb_build_array($2::int) AND (tool_output->'events'->0->>'recordedAt')::timestamptz >= $3 AND (tool_output->'events'->0->>'recordedAt')::timestamptz < $4 LIMIT 201",
          [companyIds, siteId, startsAt, endsAt],
        );
        if (saved.rows.length > 200)
          throw new FleetError("fleet.site_activity_capacity_reached", 409);
        const runs = new Map<string, FleetRun>();
        for (const row of saved.rows) {
          const run = FleetRunSchema.parse(row.tool_output);
          if (
            run.companyId === row.vendor_id &&
            companyIds.includes(run.companyId)
          )
            runs.set(run.id, run);
        }
        for (const company of companies.rows)
          for (const value of company.fleet_ops_state?.runs ?? []) {
            const run = FleetRunSchema.parse(value);
            if (run.companyId === company.id && run.siteIds.includes(siteId))
              runs.set(run.id, run);
          }
        const selected = [...runs.values()].filter(
          (run) =>
            run.siteIds.includes(siteId) &&
            Date.parse(run.events[0]?.recordedAt ?? "") >=
              Date.parse(startsAt) &&
            Date.parse(run.events[0]?.recordedAt ?? "") < Date.parse(endsAt),
        );
        if (selected.length > 200)
          throw new FleetError("fleet.site_activity_capacity_reached", 409);
        return {
          siteId,
          siteName: site.rows[0].name,
          window: { startsAt, endsAt, dateBasis: "run_created_at" },
          records: selected.map((run) =>
            projectFleetSiteRun(
              run,
              siteId,
              companies.rows.find((c) => c.id === run.companyId)!.name,
            ),
          ),
          source: "recorded_fleet_events",
          coordinateDisclosure: false,
          unavailableMetrics: [
            "No other-site route, driver identity, coordinates, fuel, costs, or company roster is disclosed.",
            "Date window selects runs by creation time; selected-site entries may be recorded later.",
            "Device/provider ETA and physical arrival verification are not inferred.",
          ],
        };
      });
    },
  };
}
