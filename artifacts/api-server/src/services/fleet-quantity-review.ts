import { z } from "zod/v4";
import {
  FleetWorkScopeSchema,
  FleetQuantityEvidenceSchema,
  FleetDetailSnapshotSchema,
  FleetRunSchema,
  fleetDetailSnapshotIdentityMatches,
  FleetQuantityReviewSchema,
  type FleetRun,
  type FleetWorkCommand,
} from "@workspace/api-zod";
import { FleetError } from "./fleet-repository";
import type { FleetWorkExecutionContext } from "./fleet-work-repository";

const reportSchema = z
  .object({
    version: z.literal(2),
    scope: FleetWorkScopeSchema,
    operationId: z.uuid(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    activityId: z.uuid(),
    activityVersion: z.number().int().positive(),
    ticketId: z.number().int().positive(),
    assignment: FleetDetailSnapshotSchema,
    evidence: FleetQuantityEvidenceSchema,
    capturedAt: z.iso.datetime({ offset: true }),
    timeZone: z.string(),
    receivedAt: z.iso.datetime({ offset: true }),
    clockStatus: z.enum(["ahead_of_server", "reported_capture_time"]),
    officeReviewRequired: z.literal(true),
    quantitySourceVerified: z.literal(false),
  })
  .strict();

/** Internal: the enclosing original-scope transaction has loaded this actual
 * currently authorized run through the canonical service. A source endorsement
 * is separate from physical closure, charge approval and ticket submission. */
export async function reviewFleetQuantityEvidence(
  context: FleetWorkExecutionContext,
  command: Extract<FleetWorkCommand, { kind: "quantity.review" }>,
  run: FleetRun,
) {
  const { actor, state, client } = context;
  const grant = state.grants.find((g) => g.userId === actor.userId);
  if (
    actor.readOnly ||
    !state.enabled ||
    run.companyId !== actor.companyId ||
    !grant?.roles.some((r) => r === "fleet_manager" || r === "dispatcher") ||
    !grant.fleetIds.includes(run.fleetId) ||
    !run.siteIds.every((id) => grant.siteIds.includes(id))
  )
    throw new FleetError("fleet.dispatch_required", 403);
  const ticket = (
    await client.query(
      "SELECT id,status FROM tickets WHERE id=$1 AND vendor_id=$2 FOR UPDATE",
      [run.linkedTicketId, actor.companyId],
    )
  ).rows[0];
  if (!ticket) throw new FleetError("fleet.billing_ticket_mismatch");
  if (
    ![
      "draft",
      "initiated",
      "in_progress",
      "pending_review",
      "kicked_back",
      "completed",
    ].includes(ticket.status)
  )
    throw new FleetError("fleet.ticket_closed");
  const reviewedAt = new Date().toISOString();
  for (const selected of command.payload.selections) {
    const row = (
      await client.query(
        "SELECT user_id,tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-work-quantity' AND target_id=$2 ORDER BY id DESC LIMIT 1",
        [actor.companyId, selected.evidenceId],
      )
    ).rows[0];
    if (!row) throw new FleetError("fleet.quantity_source_unresolved");
    const original = reportSchema.parse(row.tool_output);
    if (
      original.scope.owner.type !== "vendor" ||
      original.scope.owner.id !== actor.companyId ||
      row.user_id !== original.scope.userId ||
      original.evidence.recordedByUserId !== row.user_id ||
      original.evidence.id !== selected.evidenceId ||
      original.activityId !== run.id ||
      original.ticketId !== ticket.id
    )
      throw new FleetError("fleet.quantity_source_unresolved");
    const saved = (
      await client.query(
        "SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-run' AND target_id=$2 AND tool_output->>'version'=$3 ORDER BY id DESC LIMIT 1",
        [actor.companyId, run.id, String(original.activityVersion)],
      )
    ).rows[0];
    const performed = saved && FleetRunSchema.parse(saved.tool_output);
    if (
      !performed?.resourceAssignment ||
      performed.linkedTicketId !== ticket.id ||
      performed.driverUserId !== row.user_id ||
      !fleetDetailSnapshotIdentityMatches(
        performed.resourceAssignment.snapshot,
        original.assignment,
      )
    )
      throw new FleetError("fleet.work_assignment_changed");
    const priorRaw = (
      await client.query(
        "SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-work-quantity-review' AND target_id=$2 ORDER BY id DESC LIMIT 1",
        [actor.companyId, selected.evidenceId],
      )
    ).rows[0]?.tool_output;
    const prior = priorRaw ? FleetQuantityReviewSchema.parse(priorRaw) : null;
    if (
      prior &&
      (prior.vendorId !== actor.companyId ||
        prior.activityId !== run.id ||
        prior.ticketId !== ticket.id ||
        prior.evidenceId !== selected.evidenceId ||
        prior.reportFingerprint !== original.fingerprint)
    )
      throw new FleetError("fleet.quantity_source_unresolved");
    const revision = prior?.revision ?? 0;
    if (revision !== selected.expectedReviewRevision)
      throw new FleetError("fleet.quantity_review_version_conflict");
    // Claimed conversion reviewer IDs in a driver's report are not an office
    // endorsement of its factor. Keep it unresolved until explicitly reviewed.
    if (
      selected.decision === "accept_as_billable" &&
      original.evidence.conversion
    )
      throw new FleetError("fleet.quantity_conversion_review_required");
    if (
      selected.decision === "accept_as_billable" &&
      original.evidence.kind === "planned"
    )
      throw new FleetError("fleet.quantity_performed_source_required");
    const review = FleetQuantityReviewSchema.parse({
      version: 2,
      revision: revision + 1,
      operationId: command.operationId,
      vendorId: actor.companyId,
      evidenceId: selected.evidenceId,
      reportOperationId: original.operationId,
      reportFingerprint: original.fingerprint,
      activityId: run.id,
      originalActivityVersion: original.activityVersion,
      ticketId: ticket.id,
      decision: selected.decision,
      reason: selected.reason,
      reviewedByUserId: actor.userId,
      reviewedAt,
      reportedReviewAt: command.capturedAt,
      reportedReviewTimeZone: command.timeZone,
      quantity:
        selected.decision === "accept_as_billable"
          ? FleetQuantityEvidenceSchema.parse({
              ...original.evidence,
              kind: "billable",
            })
          : null,
      independentInstrumentVerification: false,
    });
    await client.query(
      "INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,'fleet','typed','canonical','fleet_work','quantity-reviewed','fleet-work-quantity-review',$3,$4::jsonb,'completed')",
      [
        actor.userId,
        actor.companyId,
        selected.evidenceId,
        JSON.stringify(review),
      ],
    );
  }
}
