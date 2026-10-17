import {
  createFleetWorkCanonicalService,
  resolveFleetWorkReference,
} from "./fleet-work-canonical";
import {
  FleetRunSchema,
  FleetEvidenceSchema,
  FleetWorkEvidenceCaptureSchema,
  FleetWorkEvidencePageSchema,
  FleetWorkScopeSchema,
  type FleetEvidenceUploadSession,
  type FleetWorkScope,
} from "@workspace/api-zod";
import { z } from "zod/v4";
import { validateFleetEvidenceObject } from "./fleet-evidence";
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import type { FleetWorkExecutionContext } from "./fleet-work-repository";
import type { FleetEvidenceUploadTransaction } from "./fleet-evidence-upload";
import { getObjectStore, type ObjectStore } from "../lib/objectStore";
import { FleetError } from "./fleet-repository";

/** The canonical private-document owner rechecks subject, current revision and
 * submitter permissions at begin AND association. Receiving bytes never adopts
 * a rule, verifies a source, or changes a compliance assessment to green. */
export function createFleetEvidenceCanonicalHandlers(
  options: {
    store?: () => ObjectStore;
    secret?: () => string;
    now?: () => Date;
  } = {},
) {
  const store = options.store ?? getObjectStore;
  const service = (context: FleetWorkExecutionContext) =>
    createFleetWorkCanonicalService(context, {
      compliance: {
        store,
        ...(options.secret ? { secret: options.secret } : {}),
        ...(options.now ? { now: options.now } : {}),
      },
    });
  const authorizeWork = async (
    context: FleetWorkExecutionContext,
    scope: FleetWorkScope,
    binding: Extract<FleetEvidenceUploadSession["binding"], { kind: "work" }>,
  ) => {
    const { actor, state, client } = context;
    if (actor.readOnly || !state.enabled)
      throw new FleetError("fleet.action_forbidden", 403);
    const activity = await resolveFleetWorkReference(
        context,
        scope,
        binding.activity,
      ),
      ticket = await resolveFleetWorkReference(context, scope, binding.ticket);
    if (activity.kind !== "activity" || ticket.kind !== "ticket")
      throw new FleetError("fleet.invalid_request", 400);
    // Capture is bound to an actually saved revision, never the latest assignment
    // substituted at upload time. A closed parent ticket still retains its facts.
    const rows = await client.query(
      "SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-run' AND target_id=$2 AND tool_output->>'version'=$3 ORDER BY id DESC LIMIT 1",
      [actor.companyId, activity.id, String(activity.version)],
    );
    if (!rows.rows.length)
      throw new FleetError("fleet.work_assignment_changed");
    const original = FleetRunSchema.parse(rows.rows[0].tool_output),
      grant = state.grants.find((g) => g.userId === actor.userId);
    if (
      original.companyId !== actor.companyId ||
      original.driverUserId !== actor.userId ||
      !grant?.roles.includes("driver") ||
      !grant.fleetIds.includes(original.fleetId) ||
      !state.fleets.some((g) => g.id === original.fleetId)
    )
      throw new FleetError("fleet.action_forbidden", 403);
    if (
      !original.resourceAssignment ||
      !isDeepStrictEqual(
        original.resourceAssignment.snapshot,
        binding.assignment,
      ) ||
      original.linkedTicketId !== ticket.id
    )
      throw new FleetError("fleet.work_assignment_changed");
    const parent = await client.query(
      "SELECT id FROM tickets WHERE id=$1 AND vendor_id=$2",
      [ticket.id, actor.companyId],
    );
    if (!parent.rows.length)
      throw new FleetError("fleet.work_assignment_changed");
    return { original, ticket };
  };
  const authorizeRead = async (
    context: FleetWorkExecutionContext,
    activityId: string,
  ) => {
    const { actor, state, client } = context,
      grant = state.grants.find((g) => g.userId === actor.userId);
    if (!state.enabled || !grant?.roles.length)
      throw new FleetError("fleet.action_forbidden", 403);
    const rows = await client.query(
      "SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-run' AND target_id=$2 ORDER BY id DESC LIMIT 1",
      [actor.companyId, activityId],
    );
    if (!rows.rows.length) throw new FleetError("fleet.not_found", 404);
    const current = FleetRunSchema.parse(rows.rows[0].tool_output);
    if (
      !grant.fleetIds.includes(current.fleetId) ||
      !state.fleets.some((g) => g.id === current.fleetId)
    )
      throw new FleetError("fleet.action_forbidden", 403);
    if (
      grant.roles.includes("fleet_manager") ||
      grant.roles.includes("dispatcher")
    ) {
      if (!state.runs.some((run) => run.id === activityId))
        state.runs.push(current);
      await service(context).detail({ ...actor }, activityId);
      return false;
    }
    if (!grant.roles.includes("driver"))
      throw new FleetError("fleet.action_forbidden", 403);
    // A replaced driver can read only their own retained evidence, never the
    // replacement's records or arbitrary company activity details.
    return true;
  };
  const pageInput = z.object({
    scope: FleetWorkScopeSchema,
    activityId: z.uuid(),
    cursor: z.string().max(2000).nullable(),
    limit: z.number().int().min(1).max(100),
  });
  const cursorSchema = z
    .object({
      companyId: z.number().int().positive(),
      userId: z.number().int().positive(),
      activityId: z.uuid(),
      ceiling: z.number().int().nonnegative(),
      before: z.number().int().positive(),
    })
    .strict();
  const storedEvidence = z
    .object({
      record: FleetEvidenceSchema,
      fingerprint: z.string(),
      objectPath: z.string(),
      capture: FleetWorkEvidenceCaptureSchema.extend({
        scope: FleetWorkScopeSchema,
      })
        .strict()
        .optional(),
    })
    .strict();
  const project = (input: unknown) => {
    const value = storedEvidence.parse(input);
    return {
      record: value.record,
      capture: value.capture
        ? (({ scope: _scope, ...capture }) => capture)(value.capture)
        : null,
    };
  };
  const requireReadScope = (
    context: FleetWorkExecutionContext,
    input: FleetWorkScope,
  ) => {
    const scope = FleetWorkScopeSchema.parse(input),
      { actor } = context;
    if (
      scope.owner.type !== "vendor" ||
      scope.owner.id !== actor.companyId ||
      scope.userId !== actor.userId ||
      scope.membershipId !== actor.activeMembershipId ||
      scope.sessionVersion !== actor.sv
    )
      throw new FleetError("fleet.work_scope_changed", 403);
  };
  return {
    async readWorkEvidence(
      context: FleetWorkExecutionContext,
      input: {
        scope: FleetWorkScope;
        activityId: string;
        cursor: string | null;
        limit: number;
      },
    ) {
      requireReadScope(context, input.scope);
      const parsed = pageInput.parse(input),
        { actor, client } = context,
        own = await authorizeRead(context, parsed.activityId);
      let cursor: z.infer<typeof cursorSchema> | null = null;
      if (parsed.cursor) {
        try {
          cursor = cursorSchema.parse(
            JSON.parse(
              Buffer.from(parsed.cursor, "base64url").toString("utf8"),
            ),
          );
        } catch {
          throw new FleetError("fleet.invalid_cursor", 400);
        }
        if (
          cursor.companyId !== actor.companyId ||
          cursor.userId !== actor.userId ||
          cursor.activityId !== parsed.activityId ||
          cursor.before > cursor.ceiling
        )
          throw new FleetError("fleet.invalid_cursor", 400);
      }
      const ceiling =
        cursor?.ceiling ??
        Number(
          (
            await client.query(
              "SELECT COALESCE(MAX(id),0)::int AS id FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-evidence'",
              [actor.companyId],
            )
          ).rows[0].id,
        );
      const rows = await client.query(
        "SELECT id,tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-evidence' AND tool_output->'record'->>'runId'=$2 AND id<=$3 AND ($4::int IS NULL OR id<$4) AND ($5::int IS NULL OR user_id=$5) ORDER BY id DESC LIMIT $6",
        [
          actor.companyId,
          parsed.activityId,
          ceiling,
          cursor?.before ?? null,
          own ? actor.userId : null,
          parsed.limit + 1,
        ],
      );
      const page = rows.rows.slice(0, parsed.limit);
      return FleetWorkEvidencePageSchema.parse({
        evidence: page.map((row) => project(row.tool_output)),
        nextCursor:
          rows.rows.length > parsed.limit
            ? Buffer.from(
                JSON.stringify({
                  companyId: actor.companyId,
                  userId: actor.userId,
                  activityId: parsed.activityId,
                  ceiling,
                  before: Number(page.at(-1)!.id),
                }),
              ).toString("base64url")
            : null,
      });
    },
    async readWorkEvidenceFile(
      context: FleetWorkExecutionContext,
      scope: FleetWorkScope,
      evidenceId: string,
    ) {
      requireReadScope(context, scope);
      const { actor, client } = context;
      const rows = await client.query(
        "SELECT user_id,tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-evidence' AND target_id=$2 ORDER BY id DESC LIMIT 1",
        [actor.companyId, z.uuid().parse(evidenceId)],
      );
      const row = rows.rows[0];
      if (!row) throw new FleetError("fleet.not_found", 404);
      const value = storedEvidence.parse(row.tool_output),
        record = value.record,
        own = await authorizeRead(context, record.runId);
      if (
        record.companyId !== actor.companyId ||
        record.evidenceId !== evidenceId ||
        (own &&
          (row.user_id !== actor.userId ||
            record.recordedByUserId !== actor.userId))
      )
        throw new FleetError("fleet.not_found", 404);
      const expectedPath = `/objects/fleet/${actor.companyId}/${record.runId}/${record.evidenceId}`;
      if (value.objectPath !== expectedPath)
        throw new FleetError("fleet.not_found", 404);
      const object = await store().getObject(expectedPath);
      if (
        !object ||
        object.acl?.owner !== String(record.recordedByUserId) ||
        object.acl.visibility !== "private" ||
        object.acl.purpose !== "fleet-evidence" ||
        object.size !== record.size ||
        object.body.length !== record.size ||
        object.contentType !== record.contentType ||
        createHash("sha256").update(object.body).digest("hex") !== record.sha256
      )
        throw new FleetError("fleet.not_found", 404);
      validateFleetEvidenceObject(object);
      return { object, ...project(value) };
    },
    async authorize(
      context: FleetWorkExecutionContext,
      ...[command]: Parameters<FleetEvidenceUploadTransaction["authorize"]>
    ) {
      if (command.kind === "evidence.stage") {
        await authorizeWork(context, command.scope, {
          kind: "work",
          activity: command.payload.activity,
          ticket: command.payload.ticket,
          assignment: command.payload.assignment,
          evidenceKind: command.payload.kind,
          notes: command.payload.notes,
        });
        return;
      }
      await service(context).authorizeFleetComplianceDocument(
        { ...context.actor },
        {
          recordId: command.payload.recordId,
          subject: command.payload.subject,
          expectedRecordVersion: command.payload.expectedRecordVersion,
        },
      );
    },
    async associate(
      context: FleetWorkExecutionContext,
      ...[session, bytes]: Parameters<
        FleetEvidenceUploadTransaction["associate"]
      >
    ) {
      if (session.binding.kind === "work") {
        const { original, ticket } = await authorizeWork(
            context,
            session.scope,
            session.binding,
          ),
          { actor, client } = context;
        const path = `/objects/fleet/${actor.companyId}/${original.id}/${session.canonicalEvidenceId}`;
        const fileUrl = `/api/fleet/work/evidence/${session.canonicalEvidenceId}/file`;
        const prior = await client.query(
          "SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-evidence' AND target_id=$2 ORDER BY id DESC LIMIT 1",
          [actor.companyId, session.canonicalEvidenceId],
        );
        if (prior.rows.length) {
          const saved = prior.rows[0].tool_output;
          if (
            saved.fingerprint !== session.fingerprint ||
            saved.objectPath !== path ||
            saved.record.recordedByUserId !== actor.userId
          )
            throw new FleetError("fleet.operation_conflict");
          return {
            evidenceId: session.canonicalEvidenceId,
            objectPath: path,
            fileUrl,
          };
        }
        const contentHash = (body: Buffer) =>
            createHash("sha256").update(body).digest("hex"),
          existing = await store().getObject(path);
        if (existing) {
          if (
            existing.acl?.owner !== String(actor.userId) ||
            existing.acl.purpose !== "fleet-evidence" ||
            existing.acl.visibility !== "private" ||
            existing.size !== bytes.length ||
            existing.contentType !== session.contentType ||
            contentHash(existing.body) !== session.sha256
          )
            throw new FleetError("fleet.operation_conflict");
        } else
          await store().putObject(path, session.contentType, bytes, {
            owner: String(actor.userId),
            visibility: "private",
            purpose: "fleet-evidence",
          });
        const receivedAt = (options.now?.() ?? new Date()).toISOString();
        const record = FleetEvidenceSchema.parse({
          evidenceId: session.canonicalEvidenceId,
          runId: original.id,
          companyId: actor.companyId,
          operationId: session.operationId,
          runVersion: original.version,
          kind: session.binding.evidenceKind,
          stopId: null,
          loadId: null,
          notes: session.binding.notes,
          size: bytes.length,
          contentType: session.contentType,
          sha256: session.sha256,
          recordedByUserId: actor.userId,
          recordedAt: receivedAt,
          capturedAt: new Date(session.capturedAt).toISOString(),
          source: "device_upload",
          physicalProofVerified: false,
          signatureIdentityVerified: false,
          fileUrl,
        });
        const capture = {
          scope: session.scope,
          ticketId: ticket.id,
          assignment: session.binding.assignment,
          capturedAt: session.capturedAt,
          timeZone: session.timeZone,
          receivedAt,
          clockStatus:
            Date.parse(session.capturedAt) > Date.parse(receivedAt) + 300000
              ? "ahead_of_server"
              : "reported_capture_time",
        };
        await client.query(
          "INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,'fleet','typed','canonical','fleet_evidence','evidence-associated','fleet-evidence',$3,$4::jsonb,'completed')",
          [
            actor.userId,
            actor.companyId,
            session.canonicalEvidenceId,
            JSON.stringify({
              record,
              fingerprint: session.fingerprint,
              objectPath: path,
              capture,
            }),
          ],
        );
        // This evidence fact does not inspect/start/close a vehicle, append a
        // current-assignment event, change billing, or advance the run revision.
        return {
          evidenceId: session.canonicalEvidenceId,
          objectPath: path,
          fileUrl,
        };
      }
      const owner = service(context),
        binding = session.binding;
      await owner.authorizeFleetComplianceDocument(
        { ...context.actor },
        {
          recordId: binding.recordId,
          subject: binding.subject,
          expectedRecordVersion: binding.expectedRecordVersion,
        },
      );
      const received = await owner.uploadComplianceDocument(
        { ...context.actor },
        {
          operationId: session.operationId,
          recordId: binding.recordId,
          subject: binding.subject,
          contentType: session.contentType,
          bodyBase64: bytes.toString("base64"),
        },
      );
      return {
        evidenceId: session.canonicalEvidenceId,
        objectPath: received.objectPath,
        fileUrl: null,
      };
    },
  };
}
