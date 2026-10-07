import { FleetRunSchema, type FleetRun } from "@workspace/api-zod";
import type { PoolClient } from "pg";
import type {
  FleetRepository,
  FleetSessionAuthority,
} from "./fleet-repository";

export type FleetItemizedAuthority = FleetSessionAuthority & {
  runId?: string;
  runPage?: { cursor?: string; limit: number };
  pageRunIds?: string[];
  pageRuns?: FleetRun[];
  currentRunsById?: Map<string, FleetRun>;
  nextRunCursor?: string | null;
};

function storedRun(run: FleetRun): FleetRun {
  const { labels: _labels, ...record } = run;
  return FleetRunSchema.parse(record);
}

/** Existing indexed audit identities retain immutable business snapshots.
 * Vendor JSON keeps only open runs; historical runs and operation results are
 * never pruned. Both stores participate in the existing vendor row transaction.
 */
export function createItemizedFleetRepository(
  base: FleetRepository,
  capacityError: (code?: string, status?: number) => Error,
): FleetRepository {
  return {
    transaction(companyId, actorUserId, operation, rawAuthority) {
      const authority = rawAuthority as FleetItemizedAuthority | undefined;
      return base.transaction(
        companyId,
        actorUserId,
        async (state, client) => {
          const original = new Map(
            state.runs.map((run) => [run.id, storedRun(run)]),
          );
          // Additive transition: preserve every legacy aggregate record before
          // removing any terminal copy from the bounded operational aggregate.
          for (const run of original.values()) {
            const prior = await client.query(
              "SELECT id FROM assistant_action_audit WHERE target_type='fleet-run' AND target_id=$1 AND vendor_id=$2 AND tool_output->>'version'=$3 LIMIT 1",
              [run.id, companyId, String(run.version)],
            );
            if (!prior.rows.length)
              await appendSnapshot(client, companyId, actorUserId, run);
          }
          if (authority?.runId && !original.has(authority.runId)) {
            const result = await client.query(
              "SELECT tool_output FROM assistant_action_audit WHERE target_type='fleet-run' AND target_id=$1 AND vendor_id=$2 ORDER BY id DESC LIMIT 1",
              [authority.runId, companyId],
            );
            if (result.rows.length)
              state.runs.push(FleetRunSchema.parse(result.rows[0].tool_output));
          }
          if (authority?.runPage) {
            const page = await readRunPage(
              client,
              companyId,
              authority.runPage.cursor,
              authority.runPage.limit,
              () => capacityError("fleet.invalid_cursor", 400),
            );
            authority.pageRunIds = page.runs.map((run) => run.id);
            authority.pageRuns = page.runs;
            const current = await client.query(
              "SELECT tool_output FROM (SELECT DISTINCT ON(target_id) tool_output,target_id,id FROM assistant_action_audit WHERE target_type='fleet-run' AND vendor_id=$1 AND target_id=ANY($2::text[]) ORDER BY target_id,id DESC) latest",
              [companyId, page.runs.map((r) => r.id)],
            );
            authority.currentRunsById = new Map(
              current.rows.map((row) => {
                const run = FleetRunSchema.parse(row.tool_output);
                return [run.id, run];
              }),
            );
            authority.nextRunCursor = page.nextCursor;
            const loaded = new Set(state.runs.map((run) => run.id));
            state.runs.push(...page.runs.filter((run) => !loaded.has(run.id)));
          }
          const loadedBefore = new Map(
            state.runs.map((run) => [run.id, JSON.stringify(storedRun(run))]),
          );
          const result = await operation(state, client);
          for (const run of state.runs) {
            const record = storedRun(run);
            if (loadedBefore.get(run.id) !== JSON.stringify(record)) {
              await appendSnapshot(client, companyId, actorUserId, record);
            }
            // Preserve original open records, and merge all actually changed
            // records; a read-only historical page cannot overwrite live state.
            if (
              original.has(run.id) ||
              loadedBefore.get(run.id) !== JSON.stringify(record)
            )
              original.set(run.id, record);
          }
          state.runs = [...original.values()].filter(
            (run) => !["completed", "cancelled"].includes(run.status),
          );
          if (state.runs.length > 500) throw capacityError();
          return result;
        },
        rawAuthority,
      );
    },
  };
}

async function appendSnapshot(
  client: PoolClient,
  companyId: number,
  actorUserId: number,
  run: FleetRun,
) {
  await client.query(
    "INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,'fleet','typed','canonical','fleet_run','fleet-run-snapshot','fleet-run',$3,$4::jsonb,'completed')",
    [actorUserId, companyId, run.id, JSON.stringify(storedRun(run))],
  );
}

export async function readRunPage(
  client: PoolClient,
  companyId: number,
  cursor: string | undefined,
  requestedLimit: number,
  invalidCursor: () => Error = () => new Error("Invalid Fleet run cursor"),
) {
  const limit = Math.max(1, Math.min(50, requestedLimit));
  let upper: number;
  let before: number;
  if (cursor) {
    const match = /^(\d{1,10}):(\d{1,10})$/.exec(cursor);
    if (!match) throw invalidCursor();
    upper = Number(match[1]);
    before = Number(match[2]);
    if (
      !Number.isSafeInteger(upper) ||
      !Number.isSafeInteger(before) ||
      before > upper ||
      before < 1
    )
      throw invalidCursor();
  } else {
    const maximum = await client.query(
      "SELECT COALESCE(MAX(id),0)::int AS id FROM assistant_action_audit WHERE target_type='fleet-run' AND vendor_id=$1",
      [companyId],
    );
    upper = maximum.rows[0].id;
    before = upper + 1;
  }
  const records = await client.query(
    "SELECT id,tool_output FROM (SELECT DISTINCT ON(target_id) id,tool_output FROM assistant_action_audit WHERE target_type='fleet-run' AND vendor_id=$1 AND id<=$2 ORDER BY target_id,id DESC) latest WHERE id<$3 ORDER BY id DESC LIMIT $4",
    [companyId, upper, before, limit + 1],
  );
  const included = records.rows.slice(0, limit);
  return {
    runs: included.map((row) => FleetRunSchema.parse(row.tool_output)),
    nextCursor:
      records.rows.length > limit ? `${upper}:${included.at(-1)!.id}` : null,
  };
}
