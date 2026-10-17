import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod/v4";
import { pool } from "@workspace/db";
import {
  WorkdayScopeSchema,
  WorkdayCommandSchema,
  WorkdayEventSchema,
  WorkdaySnapshotSchema,
  WorkdayReceiptSchema,
  sameWorkdayOwner,
  summarizeWorkday,
  workdayTimeInRange,
  type WorkdayScope,
  type WorkdaySnapshot,
  type WorkdayEvent,
} from "@workspace/api-zod";
import type { PoolClient } from "pg";
import type { SessionPayload } from "../lib/session";
import { FleetStateSchema } from "./fleet-repository";

export class WorkdayError extends Error {
  constructor(
    public code: string,
    public status = 409,
  ) {
    super(code);
  }
}
const StoredOperationSchema = z
  .object({
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    event: WorkdayEventSchema,
    receipt: WorkdayReceiptSchema,
  })
  .strict();
const RangeSchema = z
  .object({
    start: z.iso.datetime(),
    end: z.iso.datetime(),
    after: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict()
  .refine(
    (value) => Date.parse(value.start) < Date.parse(value.end),
    "Invalid workday range",
  );
function sessionScope(session: SessionPayload): WorkdayScope {
  if (!session.userId) throw new WorkdayError("auth.unauthenticated", 401);
  if (Boolean(session.vendorId) === Boolean(session.partnerId))
    throw new WorkdayError("workday.employer_context_required", 403);
  const parsed = WorkdayScopeSchema.safeParse({
    owner: {
      type: session.vendorId ? "vendor" : "partner",
      id: session.vendorId ?? session.partnerId,
    },
    userId: session.userId,
    membershipId: session.activeMembershipId,
    sessionVersion: session.sv,
  });
  if (!parsed.success)
    throw new WorkdayError("workday.current_membership_required", 403);
  return parsed.data;
}
async function transaction<T>(
  session: SessionPayload,
  work: (client: PoolClient, scope: WorkdayScope) => Promise<T>,
): Promise<T> {
  const scope = sessionScope(session),
    client = await pool.connect();
  try {
    await client.query("BEGIN");
    const user = await client.query(
      "SELECT session_version,suspended_at,must_change_password FROM users WHERE id=$1 FOR SHARE",
      [scope.userId],
    );
    if (
      !user.rows.length ||
      user.rows[0].session_version !== scope.sessionVersion ||
      user.rows[0].suspended_at ||
      user.rows[0].must_change_password
    )
      throw new WorkdayError("workday.current_session_required", 403);
    const member = await client.query(
      "SELECT id FROM user_org_memberships WHERE id=$1 AND user_id=$2 AND org_type=$3 AND role=$4 AND CASE WHEN org_type='vendor' THEN vendor_id ELSE partner_id END=$5 FOR SHARE",
      [
        scope.membershipId,
        scope.userId,
        scope.owner.type,
        session.membershipRole,
        scope.owner.id,
      ],
    );
    if (!member.rows.length)
      throw new WorkdayError("workday.current_membership_required", 403);
    if (session.role === "field_employee") {
      const person = await client.query(
        "SELECT id FROM vendor_people WHERE id=$1 AND user_id=$2 AND vendor_id=$3 AND is_active=true AND deleted_at IS NULL FOR SHARE",
        [session.vendorPeopleId, scope.userId, scope.owner.id],
      );
      if (
        scope.owner.type !== "vendor" ||
        session.membershipRole !== "field_employee" ||
        !person.rows.length
      )
        throw new WorkdayError("workday.current_person_required", 403);
    }
    const result = await work(client, scope);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
function columns(scope: WorkdayScope) {
  return scope.owner.type === "vendor"
    ? { own: "vendor_id", other: "partner_id" }
    : { own: "partner_id", other: "vendor_id" };
}
async function lock(
  client: PoolClient,
  scope: WorkdayScope,
  workerUserId = scope.userId,
) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `workday:${scope.owner.type}:${scope.owner.id}:${workerUserId}`,
  ]);
}
async function readRecord(
  client: PoolClient,
  scope: WorkdayScope,
  target: string,
  id: string,
) {
  const { own, other } = columns(scope),
    result = await client.query(
      `SELECT tool_output FROM assistant_action_audit WHERE ${own}=$1 AND ${other} IS NULL AND target_type=$2 AND target_id=$3 ORDER BY id DESC LIMIT 1`,
      [scope.owner.id, target, id],
    );
  return result.rows[0]?.tool_output ?? null;
}
async function append(
  client: PoolClient,
  session: SessionPayload,
  scope: WorkdayScope,
  target: string,
  id: string,
  value: unknown,
) {
  await client.query(
    "INSERT INTO assistant_action_audit(user_id,vendor_id,partner_id,actor_role,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,$3,$4,'work-hub','typed','canonical','workday','workday-record',$5,$6,$7::jsonb,'completed')",
    [
      scope.userId,
      scope.owner.type === "vendor" ? scope.owner.id : null,
      scope.owner.type === "partner" ? scope.owner.id : null,
      session.role ?? null,
      target,
      id,
      JSON.stringify(value),
    ],
  );
}
async function authorizeRead(
  client: PoolClient,
  session: SessionPayload,
  scope: WorkdayScope,
  workerUserId: number,
) {
  if (scope.userId === workerUserId || session.membershipRole === "admin")
    return;
  if (scope.owner.type === "vendor") {
    const result = await client.query(
        "SELECT fleet_ops_state FROM vendors WHERE id=$1 FOR SHARE",
        [scope.owner.id],
      ),
      parsed = FleetStateSchema.safeParse(result.rows[0]?.fleet_ops_state);
    if (parsed.success && parsed.data.enabled) {
      const state = parsed.data,
        office = state.grants.find((grant) => grant.userId === scope.userId),
        worker = state.grants.find((grant) => grant.userId === workerUserId);
      if (
        office?.roles.some(
          (role) => role === "fleet_manager" || role === "dispatcher",
        ) &&
        worker?.roles.includes("driver") &&
        office.fleetIds.some(
          (id) =>
            worker.fleetIds.includes(id) &&
            state.fleets.some((group) => group.id === id),
        )
      )
        return;
    }
  }
  throw new WorkdayError("workday.read_required", 403);
}
async function events(
  client: PoolClient,
  scope: WorkdayScope,
  shiftIds: string[],
) {
  if (!shiftIds.length) return [];
  const { own, other } = columns(scope),
    result = await client.query(
      `SELECT tool_output->'event' AS event FROM assistant_action_audit WHERE ${own}=$1 AND ${other} IS NULL AND target_type='workday-event' AND tool_output->'event'->>'shiftId'=ANY($2::text[]) ORDER BY id`,
      [scope.owner.id, shiftIds],
    );
  return result.rows.map((row) => {
    const value = WorkdayEventSchema.parse(row.event);
    if (!sameWorkdayOwner(value.owner, scope.owner))
      throw new WorkdayError("workday.invalid_history");
    return value;
  });
}
async function snapshot(client: PoolClient, scope: WorkdayScope, id: string) {
  const saved = WorkdaySnapshotSchema.nullable().parse(
    await readRecord(client, scope, "workday", id),
  );
  if (!saved || saved.id !== id || !sameWorkdayOwner(saved.owner, scope.owner))
    throw new WorkdayError("workday.not_found", 404);
  return saved;
}
function verify(saved: WorkdaySnapshot, history: WorkdayEvent[]) {
  if (
    saved.version !== history.length ||
    !isDeepStrictEqual(saved.summary, summarizeWorkday(history))
  )
    throw new WorkdayError("workday.invalid_history");
}
async function openWorkday(client: PoolClient, scope: WorkdayScope) {
  const { own, other } = columns(scope),
    result = await client.query(
      `SELECT tool_output FROM (SELECT DISTINCT ON(target_id) tool_output,id FROM assistant_action_audit WHERE ${own}=$1 AND ${other} IS NULL AND target_type='workday' AND tool_output->>'workerUserId'=$2 ORDER BY target_id,id DESC) latest WHERE tool_output->'summary'->>'endedAt' IS NULL ORDER BY id DESC LIMIT 2`,
      [scope.owner.id, String(scope.userId)],
    );
  if (result.rows.length > 1)
    throw new WorkdayError("workday.multiple_open_requires_review");
  return result.rows.length
    ? WorkdaySnapshotSchema.parse(result.rows[0].tool_output)
    : null;
}

/** A single organization/worker workday for every portal and client. Domain
 * assignment, duty/contact policy, GPS and billable work remain separate facts. */
export const workdayService = {
  record: (session: SessionPayload, raw: unknown) =>
    transaction(session, async (client, scope) => {
      const command = WorkdayCommandSchema.parse(raw);
      if (!isDeepStrictEqual(command.scope, scope))
        throw new WorkdayError("workday.original_scope_required", 403);
      if (session.realm === "demo" || session.publicDemo)
        throw new WorkdayError("workday.read_only", 403);
      await lock(client, scope);
      const fingerprint = createHash("sha256")
          .update(JSON.stringify(command))
          .digest("hex"),
        prior = StoredOperationSchema.nullable().parse(
          await readRecord(client, scope, "workday-event", command.operationId),
        );
      if (prior) {
        if (
          prior.fingerprint !== fingerprint ||
          prior.event.workerUserId !== scope.userId
        )
          throw new WorkdayError("workday.operation_conflict");
        return prior.receipt;
      }
      const current = WorkdaySnapshotSchema.nullable().parse(
        await readRecord(client, scope, "workday", command.shiftId),
      );
      if (current && current.workerUserId !== scope.userId)
        throw new WorkdayError("workday.worker_required", 403);
      if (command.action === "start_shift") {
        if (await openWorkday(client, scope))
          throw new WorkdayError("workday.already_open");
      } else if (!current) throw new WorkdayError("workday.not_found", 404);
      if (current && current.timezone !== command.timezone)
        throw new WorkdayError("workday.timezone_conflict");
      const event = WorkdayEventSchema.parse({
          id: command.operationId,
          shiftId: command.shiftId,
          owner: scope.owner,
          workerUserId: scope.userId,
          kind: command.action,
          capturedAt: command.capturedAt,
          receivedAt: new Date().toISOString(),
          source: "worker_report",
        }),
        history = await events(client, scope, [command.shiftId]);
      if (current) verify(current, history);
      let summary;
      try {
        summary = summarizeWorkday([...history, event]);
      } catch (error) {
        const code = error instanceof Error ? error.message : "";
        throw new WorkdayError(
          code.startsWith("fleet.workday_")
            ? `workday.${code.slice("fleet.workday_".length)}`
            : "workday.invalid_transition",
        );
      }
      const version = (current?.version ?? 0) + 1,
        receipt = WorkdayReceiptSchema.parse({
          operationId: command.operationId,
          shiftId: command.shiftId,
          version,
          event,
          summary,
        }),
        saved = WorkdaySnapshotSchema.parse({
          id: command.shiftId,
          version,
          owner: scope.owner,
          workerUserId: scope.userId,
          timezone: command.timezone,
          summary,
        });
      await append(
        client,
        session,
        scope,
        "workday-event",
        command.operationId,
        { fingerprint, event, receipt },
      );
      await append(client, session, scope, "workday", command.shiftId, saved);
      return receipt;
    }),
  current: (session: SessionPayload) =>
    transaction(session, async (client, scope) => {
      await lock(client, scope);
      return { scope, workday: await openWorkday(client, scope) };
    }),
  read: (session: SessionPayload, rawId: string) =>
    transaction(session, async (client, scope) => {
      const id = z.uuid().parse(rawId),
        initial = await snapshot(client, scope, id);
      await authorizeRead(client, session, scope, initial.workerUserId);
      await lock(client, scope, initial.workerUserId);
      const saved = await snapshot(client, scope, id),
        history = await events(client, scope, [id]);
      verify(saved, history);
      return { ...saved, events: history };
    }),
  operation: (session: SessionPayload, rawId: string) =>
    transaction(session, async (client, scope) => {
      const id = z.uuid().parse(rawId),
        saved = StoredOperationSchema.nullable().parse(
          await readRecord(client, scope, "workday-event", id),
        );
      if (!saved) throw new WorkdayError("workday.not_found", 404);
      await authorizeRead(client, session, scope, saved.event.workerUserId);
      return saved.receipt;
    }),
  list: (session: SessionPayload, rawWorkerUserId: number, raw: unknown) =>
    transaction(session, async (client, scope) => {
      const workerUserId = z.number().int().positive().parse(rawWorkerUserId),
        input = RangeSchema.parse(raw);
      await authorizeRead(client, session, scope, workerUserId);
      await lock(client, scope, workerUserId);
      const { own, other } = columns(scope),
        rows = await client.query(
          `SELECT id,tool_output FROM (SELECT DISTINCT ON(target_id) id,tool_output FROM assistant_action_audit WHERE ${own}=$1 AND ${other} IS NULL AND target_type='workday' AND tool_output->>'workerUserId'=$2 ORDER BY target_id,id DESC) latest WHERE ($3::int IS NULL OR id<$3) AND (tool_output->'summary'->>'startedAt')::timestamptz<$5::timestamptz AND (tool_output->'summary'->>'endedAt' IS NULL OR (tool_output->'summary'->>'endedAt')::timestamptz>$4::timestamptz) ORDER BY id DESC LIMIT $6`,
          [
            scope.owner.id,
            String(workerUserId),
            input.after ?? null,
            input.start,
            input.end,
            input.limit + 1,
          ],
        );
      const page = rows.rows.slice(0, input.limit),
        history = await events(
          client,
          scope,
          page.map((row) => row.tool_output.id),
        ),
        byShift = new Map<string, WorkdayEvent[]>();
      for (const event of history)
        byShift.set(event.shiftId, [
          ...(byShift.get(event.shiftId) ?? []),
          event,
        ]);
      return {
        items: page.map((row) => {
          const saved = WorkdaySnapshotSchema.parse(row.tool_output),
            captured = byShift.get(saved.id) ?? [];
          verify(saved, captured);
          return {
            ...saved,
            reportedWorkMillisecondsInRange: workdayTimeInRange(
              captured,
              input.start,
              input.end,
            ),
          };
        }),
        range: { start: input.start, end: input.end },
        nextCursor:
          rows.rows.length > input.limit
            ? String(page[page.length - 1].id)
            : null,
      };
    }),
};
