import { ACTIVE_APPROVAL_STATUSES } from "@workspace/db";
import type { Pool, PoolClient } from "pg";
import type {
  FleetSupportChoices,
  FleetSupportRead,
  FleetSupportGrant,
  FleetRun,
} from "@workspace/api-zod";
import { FleetRunSchema } from "@workspace/api-zod";
import {
  FleetError,
  FleetStateSchema,
  type FleetState,
} from "./fleet-repository";
import { readRunPage } from "./fleet-itemized-repository";
export type FleetSupportActor = { userId: number; sv: number; role: "admin" };
export function createFleetSupportService(
  pool: Pick<Pool, "connect">,
  clock: () => Date = () => new Date(),
) {
  const transaction = async <T>(
    actor: FleetSupportActor,
    operation: (client: PoolClient) => Promise<T>,
  ) => {
    if (
      actor.role !== "admin" ||
      !Number.isInteger(actor.userId) ||
      actor.userId < 1 ||
      !Number.isInteger(actor.sv) ||
      actor.sv < 0
    )
      throw new FleetError("fleet.support_authority_required", 403);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query(
        "SELECT id FROM users WHERE id=$1 AND role='admin' AND session_version=$2 AND suspended_at IS NULL FOR SHARE",
        [actor.userId, actor.sv],
      );
      if (!current.rows.length)
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
  const grant = async (
    client: PoolClient,
    actor: FleetSupportActor,
    companyId: number,
    state: FleetState,
  ) => {
    const access = state.supportGrants.find(
      (g) =>
        g.userId === actor.userId &&
        Date.parse(g.expiresAt) > clock().getTime(),
    );
    if (!state.enabled || !access) return null;
    const sites = await client.query(
      "SELECT s.id FROM site_locations s JOIN partner_vendor_relationships r ON r.partner_id=s.partner_id WHERE r.vendor_id=$1 AND r.status=ANY($2::text[]) AND s.id=ANY($3::int[]) AND COALESCE(s.hidden,false)=false FOR SHARE OF s,r",
      [companyId, [...ACTIVE_APPROVAL_STATUSES], access.siteIds],
    );
    const siteIds = access.siteIds.filter((id) =>
        sites.rows.some((s) => s.id === id),
      ),
      fleetIds = access.fleetIds.filter((id) =>
        state.fleets.some(
          (f) => f.id === id && f.siteIds.some((s) => siteIds.includes(s)),
        ),
      );
    return siteIds.length && fleetIds.length
      ? { ...access, siteIds, fleetIds }
      : null;
  };
  const permitted = (
    run: FleetRun,
    companyId: number,
    access: FleetSupportGrant,
  ) =>
    run.companyId === companyId &&
    access.fleetIds.includes(run.fleetId) &&
    run.siteIds.every((id) => access.siteIds.includes(id));
  return {
    companies: (actor: FleetSupportActor): Promise<FleetSupportChoices> =>
      transaction(actor, async (client) => {
        const candidates = await client.query(
          "SELECT id,name,fleet_ops_state FROM vendors WHERE fleet_ops_state->>'enabled'='true' AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(fleet_ops_state->'supportGrants','[]'::jsonb)) g WHERE (g->>'userId')::int=$1 AND (g->>'expiresAt')::timestamptz>$2) ORDER BY id LIMIT 51 FOR SHARE",
          [actor.userId, clock().toISOString()],
        );
        if (candidates.rows.length > 50)
          throw new FleetError("fleet.support_company_capacity_reached", 409);
        const companies: FleetSupportChoices["companies"] = [];
        for (const row of candidates.rows) {
          const access = await grant(
            client,
            actor,
            row.id,
            FleetStateSchema.parse(row.fleet_ops_state),
          );
          if (access)
            companies.push({
              companyId: row.id,
              companyName: row.name,
              expiresAt: access.expiresAt,
              reason: access.reason,
            });
        }
        return { companies, readOnly: true };
      }),
    read: (
      actor: FleetSupportActor,
      companyId: number,
      cursor?: string,
    ): Promise<FleetSupportRead> =>
      transaction(actor, async (client) => {
        if (!Number.isInteger(companyId) || companyId < 1)
          throw new FleetError("fleet.support_not_found", 404);
        const found = await client.query(
          "SELECT id,name,fleet_ops_state FROM vendors WHERE id=$1 FOR SHARE",
          [companyId],
        );
        if (!found.rows.length)
          throw new FleetError("fleet.support_not_found", 404);
        if (!found.rows[0].fleet_ops_state)
          throw new FleetError("fleet.support_not_found", 404);
        const state = FleetStateSchema.parse(found.rows[0].fleet_ops_state),
          access = await grant(client, actor, companyId, state);
        if (!access) throw new FleetError("fleet.support_not_found", 404);
        const page = await readRunPage(
          client,
          companyId,
          cursor,
          50,
          () => new FleetError("fleet.invalid_cursor", 400),
        );
        const latest = await client.query(
          "SELECT tool_output FROM (SELECT DISTINCT ON(target_id) target_id,tool_output,id FROM assistant_action_audit WHERE target_type='fleet-run' AND vendor_id=$1 AND target_id=ANY($2::text[]) ORDER BY target_id,id DESC) latest",
          [companyId, page.runs.map((r) => r.id)],
        );
        const current = new Map(
          latest.rows.map((row) => {
            const run = FleetRunSchema.parse(row.tool_output);
            return [run.id, run] as const;
          }),
        );
        for (const run of state.runs) current.set(run.id, run);
        const runs = page.runs
          .filter(
            (run) =>
              permitted(run, companyId, access) &&
              current.has(run.id) &&
              permitted(current.get(run.id)!, companyId, access),
          )
          .map((run) => ({
            ...run,
            allowedActions: [],
            records: access.financeRead
              ? run.records
              : run.records.filter((record) => record.kind !== "fuel"),
            events: access.financeRead
              ? run.events
              : run.events.filter((event) => event.type !== "record_fuel"),
          }));
        await client.query(
          "INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_input,result_status) VALUES($1,$2,'fleet','typed','canonical','fleet_support_read','support-read','vendor',$3,$4::jsonb,'completed')",
          [
            actor.userId,
            companyId,
            String(companyId),
            JSON.stringify({
              reason: access.reason,
              expiresAt: access.expiresAt,
              runIds: runs.map((run) => run.id),
              financeRead: access.financeRead,
            }),
          ],
        );
        return {
          companyId,
          companyName: found.rows[0].name,
          expiresAt: access.expiresAt,
          reason: access.reason,
          runs,
          readOnly: true,
          coordinateDisclosure: false,
          page: { nextCursor: page.nextCursor },
        };
      }),
  };
}
