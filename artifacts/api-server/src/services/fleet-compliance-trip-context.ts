import { FleetRunSchema, type FleetRun } from "@workspace/api-zod";
import type { PoolClient } from "pg";
import { FleetError, type FleetState } from "./fleet-repository";

function cacheTrip(state: FleetState, companyId: number, raw: unknown) {
  const parsed = FleetRunSchema.safeParse(raw);
  if (!parsed.success || parsed.data.companyId !== companyId)
    throw new FleetError("fleet.record_unavailable", 503);
  const existing = state.runs.findIndex((run) => run.id === parsed.data.id);
  if (existing < 0) state.runs.push(parsed.data);
  else if (state.runs[existing].version < parsed.data.version)
    state.runs[existing] = parsed.data;
  return state.runs.find((run) => run.id === parsed.data.id)!;
}

/** Current canonical trip context; absence from the legacy JSON view is not
 * absence of work. The caller still enforces current subject/reviewer grants. */
export async function loadFleetComplianceTrip(
  state: FleetState,
  client: PoolClient,
  companyId: number,
  id: string,
): Promise<FleetRun | undefined> {
  const row = (
    await client.query(
      "SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-run' AND target_id=$2 ORDER BY id DESC LIMIT 1",
      [companyId, id],
    )
  ).rows[0];
  if (row) {
    const run = cacheTrip(state, companyId, row.tool_output);
    if (run.id !== id) throw new FleetError("fleet.not_found", 404);
    return run;
  }
  // An existing trusted transaction can also contain a not-yet-appended
  // canonical legacy record. Never treat a supplied UUID as a new trip.
  return state.runs.find((run) => run.companyId === companyId && run.id === id);
}

/** Bounded current active heads under explicit company access groups. Only
 * the subject identity/label leaves the owner; no pricing or private source. */
export async function listFleetComplianceTrips(
  state: FleetState,
  client: PoolClient,
  companyId: number,
  groupIds: readonly string[],
  query: { after?: string; search: string; limit: number },
) {
  const groups = groupIds.filter((id) =>
    state.fleets.some((group) => group.id === id),
  );
  if (!groups.length) return [];
  const rows = (
    await client.query(
      `SELECT tool_output FROM (
      SELECT DISTINCT ON(target_id) target_id,tool_output,id
      FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-run'
      ORDER BY target_id,id DESC
    ) latest WHERE tool_output->>'companyId'=$1::text
      AND tool_output->>'fleetId'=ANY($2::text[])
      AND ($3::text IS NULL OR target_id>$3)
      AND strpos(lower(tool_output->>'title'),lower($4))>0
      AND tool_output->>'status' NOT IN ('completed','cancelled')
    ORDER BY target_id LIMIT $5`,
      [companyId, groups, query.after ?? null, query.search, query.limit + 1],
    )
  ).rows;
  return rows.map((row) => {
    const run = cacheTrip(state, companyId, row.tool_output);
    return { subject: { kind: "trip" as const, id: run.id }, label: run.title };
  });
}
