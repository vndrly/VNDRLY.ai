import { readFleetRunComplianceCheckpoint } from "./fleet-compliance-work";
import { z } from "zod/v4";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { FleetActor } from "./fleet-ops";
import { FleetError } from "./fleet-repository";
import {
  FleetActionPolicySnapshotSchema,
  type FleetRun,
  type FleetActionPolicySnapshot,
} from "@workspace/api-zod";

const documentReasons = new Set([
  "coi_expired",
  "wc_expired",
  "gl_expired",
  "auto_liability_expired",
  "qualified_employee_lapse",
]);
const invalidatingReasons = new Set([
  "manual_revoke",
  "manual_unapprove",
  "manual_pending_review",
  "vendor_catalog_published",
  "vendor_pricing_changed",
]);
const scopeSchema = z
  .object({
    siteId: z.number().int().positive(),
    workTypeId: z.number().int().positive(),
    serviceApprovalId: z.number().int().positive(),
    assignmentId: z.number().int().positive(),
  })
  .strict();
export const FleetApprovalProvenanceSchema = z
  .object({
    version: z.literal(1),
    approvalEventId: z.number().int().positive(),
    lapseEventId: z.number().int().positive(),
    capturedAt: z.iso.datetime({ offset: true }),
    scopes: z.array(scopeSchema),
  })
  .strict();
export type FleetApprovalProvenance = z.infer<
  typeof FleetApprovalProvenanceSchema
>;
export type FleetApprovalEvent = {
  id: number;
  fromStatus: string | null;
  toStatus: string;
  reason: string;
  actorUserId: number | null;
  reasonDetail: unknown;
  createdAt: string;
};
export type FleetCommercialAuthority =
  | {
      allowed: true;
      basis: "current_approval" | "prior_approval_compliance_warning";
      approvalSnapshotId: string;
      warnings: string[];
    }
  | { allowed: false; denialCode: string };
function categorizedCompliance(event: FleetApprovalEvent) {
  // Legacy immutable, specific reasons are proof of derivation. Generic trigger
  // text is not: new recomputes store the independently derived result as well.
  if (documentReasons.has(event.reason)) return event.reason;
  const parsed = z
    .object({
      fleetDerivation: z.object({
        version: z.literal(1),
        derivedReason: z.string().nullable(),
        complianceOnly: z.literal(true),
      }),
    })
    .safeParse(event.reasonDetail);
  if (
    !parsed.success ||
    !["system_recompute", "vendor_compliance_updated"].includes(event.reason)
  )
    return undefined;
  const reason = parsed.data.fleetDerivation.derivedReason;
  return reason === null || documentReasons.has(reason) ? reason : undefined;
}
function explicitApproval(event: FleetApprovalEvent) {
  return (
    event.toStatus === "approved" &&
    event.actorUserId !== null &&
    ["manual_approve", "partner_eula_accepted"].includes(event.reason)
  );
}
export function evaluateFleetRelationshipAuthority(input: {
  relationshipId: number;
  status: string;
  companyId: number;
  partnerId: number;
  siteId?: number;
  workTypeId?: number;
  snapshot: unknown;
  events: FleetApprovalEvent[];
}): FleetCommercialAuthority {
  if (input.status === "approved")
    return {
      allowed: true,
      basis: "current_approval",
      warnings: [],
      approvalSnapshotId: `fleet-approval:${input.relationshipId}:current`,
    };
  if (input.status !== "auto_unapproved")
    return { allowed: false, denialCode: "fleet.commercial_authority_denied" };
  const parsed = FleetApprovalProvenanceSchema.safeParse(input.snapshot);
  if (!parsed.success)
    return {
      allowed: false,
      denialCode: "fleet.approval_reconciliation_required",
    };
  const proof = parsed.data;
  const events = [...input.events].sort((a, b) => a.id - b.id);
  const approval = events.find((e) => e.id === proof.approvalEventId);
  const lapse = events.find((e) => e.id === proof.lapseEventId);
  if (
    !approval ||
    !explicitApproval(approval) ||
    !lapse ||
    lapse.id <= approval.id ||
    lapse.fromStatus !== "approved" ||
    lapse.toStatus !== "auto_unapproved" ||
    !categorizedCompliance(lapse) ||
    Date.parse(proof.capturedAt) !== Date.parse(lapse.createdAt)
  )
    return {
      allowed: false,
      denialCode: "fleet.approval_reconciliation_required",
    };
  let prior = "approved";
  const warnings = new Set<string>();
  for (const event of events.filter((e) => e.id > approval.id)) {
    const reason = categorizedCompliance(event);
    if (
      invalidatingReasons.has(event.reason) ||
      reason === undefined ||
      event.fromStatus !== prior ||
      !["approved", "auto_unapproved"].includes(event.toStatus) ||
      (event.toStatus === "approved" && prior !== "approved")
    )
      return {
        allowed: false,
        denialCode: "fleet.commercial_authority_changed",
      };
    prior = event.toStatus;
    if (reason) warnings.add(reason);
  }
  if (prior !== input.status || !warnings.size)
    return {
      allowed: false,
      denialCode: "fleet.approval_reconciliation_required",
    };
  if (
    !proof.scopes.some(
      (scope) =>
        (input.siteId === undefined || scope.siteId === input.siteId) &&
        (input.workTypeId === undefined ||
          scope.workTypeId === input.workTypeId),
    )
  )
    return {
      allowed: false,
      denialCode: "fleet.site_service_not_previously_approved",
    };
  return {
    allowed: true,
    basis: "prior_approval_compliance_warning",
    approvalSnapshotId: `fleet-approval:${input.relationshipId}:${approval.id}:${lapse.id}`,
    warnings: [...warnings],
  };
}

/** Called only while the relationship is locked, before losing its approved status.
 * The saved scope is never expanded by a later discovery request or recompute. */
export function captureFleetApprovalProvenance(input: {
  relationshipId: number;
  companyId: number;
  partnerId: number;
  events: FleetApprovalEvent[];
  lapse: FleetApprovalEvent;
  scopes: FleetApprovalProvenance["scopes"];
}): FleetApprovalProvenance | null {
  const approval = [...input.events]
    .sort((a, b) => b.id - a.id)
    .find(explicitApproval);
  if (!approval) return null;
  const snapshot = FleetApprovalProvenanceSchema.parse({
    version: 1,
    approvalEventId: approval.id,
    lapseEventId: input.lapse.id,
    capturedAt: input.lapse.createdAt,
    scopes: input.scopes,
  });
  const result = evaluateFleetRelationshipAuthority({
    ...input,
    status: "auto_unapproved",
    snapshot,
    events: [...input.events, input.lapse],
  });
  return result.allowed ? snapshot : null;
}

type RelationshipRow = {
  relationship_id: number;
  relationship_status: string;
  partner_id: number;
  fleet_commercial_authority: unknown;
  approval_events: FleetApprovalEvent[];
};
export function authorityFromFleetRelationship(
  row: RelationshipRow,
  companyId: number,
  siteId?: number,
  workTypeId?: number,
) {
  return evaluateFleetRelationshipAuthority({
    relationshipId: row.relationship_id,
    status: row.relationship_status,
    partnerId: row.partner_id,
    companyId,
    siteId,
    workTypeId,
    snapshot: row.fleet_commercial_authority,
    events: row.approval_events ?? [],
  });
}
// Static SQL only: callers supply no aliases or client-generated fragments.
export const FLEET_APPROVAL_COLUMNS = `r.id AS relationship_id,r.status AS relationship_status,r.fleet_commercial_authority,
  r.approved_at,r.approved_by_user_id,r.approved_catalog_version_id,r.updated_at AS relationship_updated_at,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'fromStatus',e.from_status,'toStatus',e.to_status,'reason',e.reason,
    'actorUserId',e.actor_user_id,'reasonDetail',e.reason_detail,'createdAt',e.created_at) ORDER BY e.id)
    FROM partner_vendor_approval_events e WHERE e.partner_id=r.partner_id AND e.vendor_id=r.vendor_id
    AND e.id>=CASE WHEN jsonb_typeof(r.fleet_commercial_authority->'approvalEventId')='number'
      THEN (r.fleet_commercial_authority->>'approvalEventId')::int ELSE 2147483647 END),'[]'::jsonb) AS approval_events`;

export async function readFleetAuthoritySites(
  client: PoolClient,
  companyId: number,
  options: {
    siteIds?: number[];
    activeOnly?: boolean;
  } = {},
) {
  const found = await client.query(
    `SELECT s.id,s.name,s.partner_id,s.is_active,s.latitude,s.longitude,s.fleet_ticket_policy,
    ${FLEET_APPROVAL_COLUMNS}
    FROM site_locations s JOIN partner_vendor_relationships r ON r.partner_id=s.partner_id
    WHERE r.vendor_id=$1 AND r.status IN ('approved','auto_unapproved') AND COALESCE(s.hidden,false)=false
    AND ($2::int[] IS NULL OR s.id=ANY($2)) AND ($3::boolean=false OR s.is_active=true)
    ORDER BY s.id FOR SHARE OF s,r`,
    [companyId, options.siteIds ?? null, options.activeOnly ?? false],
  );
  return found.rows.filter(
    (row) => authorityFromFleetRelationship(row, companyId, row.id).allowed,
  );
}

/** Session and employee/company capabilities are checked by the caller's existing
 * Fleet transaction. This adds relationship + exact current site/service scope. */
export async function resolveFleetCommercialAuthority(
  client: PoolClient,
  actor: Pick<FleetActor, "companyId">,
  input: {
    partnerId: number;
    billingSiteId: number;
    workTypeId: number;
    workDate: string;
    purpose: "capture" | "execute" | "office_submit" | "read_history";
    policyAt: string;
  },
): Promise<FleetCommercialAuthority> {
  z.object({
    partnerId: z.number().int().positive(),
    billingSiteId: z.number().int().positive(),
    workTypeId: z.number().int().positive(),
    workDate: z.iso.date(),
    purpose: z.enum(["capture", "execute", "office_submit", "read_history"]),
    policyAt: z.iso.datetime({ offset: true }),
  })
    .strict()
    .parse(input);
  const found = await client.query(
    `SELECT s.id,s.partner_id,s.is_active,${FLEET_APPROVAL_COLUMNS},
    sw.id AS assignment_id,pw.id AS service_approval_id,pw.approved_at AS service_approved_at,pw.approved_by_user_id AS service_approved_by FROM site_locations s
    JOIN partner_vendor_relationships r ON r.partner_id=s.partner_id AND r.vendor_id=$1
    JOIN site_work_assignments sw ON sw.site_location_id=s.id AND sw.vendor_id=r.vendor_id AND sw.work_type_id=$4
    JOIN partner_vendor_work_type_approvals pw ON pw.partner_id=r.partner_id AND pw.vendor_id=r.vendor_id AND pw.work_type_id=sw.work_type_id
    JOIN vendor_work_types vw ON vw.vendor_id=r.vendor_id AND vw.work_type_id=sw.work_type_id
    WHERE s.id=$2 AND s.partner_id=$3 AND COALESCE(s.hidden,false)=false
    FOR SHARE OF s,r,sw,pw,vw`,
    [actor.companyId, input.billingSiteId, input.partnerId, input.workTypeId],
  );
  const row = found.rows[0];
  if (!row || (input.purpose !== "read_history" && !row.is_active))
    return { allowed: false, denialCode: "fleet.site_service_forbidden" };
  const authority = authorityFromFleetRelationship(
    row,
    actor.companyId,
    input.billingSiteId,
    input.workTypeId,
  );
  if (
    authority.allowed &&
    authority.basis === "prior_approval_compliance_warning"
  ) {
    const snapshot = FleetApprovalProvenanceSchema.parse(
      row.fleet_commercial_authority,
    );
    if (
      !snapshot.scopes.some(
        (scope) =>
          scope.siteId === row.id &&
          scope.workTypeId === input.workTypeId &&
          scope.assignmentId === row.assignment_id &&
          scope.serviceApprovalId === row.service_approval_id,
      )
    )
      return {
        allowed: false,
        denialCode: "fleet.site_service_not_previously_approved",
      };
  }
  if (!authority.allowed) return authority;
  const proof = {
    version: 1,
    companyId: actor.companyId,
    partnerId: input.partnerId,
    billingSiteId: input.billingSiteId,
    workTypeId: input.workTypeId,
    assignmentId: row.assignment_id,
    serviceApprovalId: row.service_approval_id,
    serviceApprovedAt: row.service_approved_at,
    serviceApprovedBy: row.service_approved_by,
    relationshipId: row.relationship_id,
    status: row.relationship_status,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by_user_id,
    approvedCatalogVersionId: row.approved_catalog_version_id,
    relationshipUpdatedAt: row.relationship_updated_at,
    basis: authority.basis,
    warnings: authority.warnings,
    provenance: row.fleet_commercial_authority ?? null,
    sourceApprovalReference: authority.approvalSnapshotId,
  };
  const snapshotId = `fleet-authority:${createHash("sha256").update(JSON.stringify(proof)).digest("hex")}`;
  // Content-addressed, append-only proof: later reapproval cannot change the
  // authority facts referenced by a saved run or office-submission checkpoint.
  await client.query(
    `INSERT INTO assistant_action_audit(vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status)
    SELECT $1,'fleet','derived','canonical','fleet_commercial_authority','authority-snapshot','fleet-commercial-authority',$2,$3::jsonb,'completed'
    WHERE NOT EXISTS(SELECT 1 FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-commercial-authority' AND target_id=$2)`,
    [actor.companyId, snapshotId, JSON.stringify(proof)],
  );
  return { ...authority, approvalSnapshotId: snapshotId };
}
export function requireFleetCommercialAuthority(
  authority: FleetCommercialAuthority,
) {
  if (!authority.allowed) throw new FleetError(authority.denialCode, 403);
  return authority;
}
export async function requireFleetRunCommercialAuthority(
  client: PoolClient,
  run: FleetRun,
  purpose: "execute" | "office_submit" = "execute",
) {
  if (!run.linkedTicketId) return; // Historical unlinked v1 work is reconciled by its existing ticket-link action.
  const ticket = (
    await client.query(
      `SELECT t.work_type_id,t.site_location_id,s.partner_id
    FROM tickets t JOIN site_locations s ON s.id=t.site_location_id WHERE t.id=$1 AND t.vendor_id=$2 FOR SHARE OF t,s`,
      [run.linkedTicketId, run.companyId],
    )
  ).rows[0];
  if (!ticket) throw new FleetError("fleet.ticket_not_found", 404);
  const binding = run.billingV2;
  if (binding && (
    binding.ticketId !== run.linkedTicketId || binding.context.vendorId !== run.companyId ||
    binding.context.partnerId !== ticket.partner_id || binding.context.billingSiteId !== ticket.site_location_id
  )) throw new FleetError("fleet.billing_ticket_mismatch", 409);
  return requireFleetCommercialAuthority(
    await resolveFleetCommercialAuthority(
      client,
      { companyId: run.companyId },
      {
        partnerId: ticket.partner_id,
        billingSiteId: ticket.site_location_id,
        workTypeId: binding?.serviceId ?? ticket.work_type_id,
        workDate:
          binding?.context.workDate ?? run.billing?.workDate ?? new Date().toISOString().slice(0, 10),
        purpose,
        policyAt: new Date().toISOString(),
      },
    ),
  );
}

export async function assessFleetActionPolicy(
  client: PoolClient,
  actor: Pick<FleetActor, "companyId">,
  input: {
    run: FleetRun;
    action: string;
    requiredCertifications: string[];
    policyAt: string;
    capturedAt?: string;
  },
) {
  const warnings: FleetActionPolicySnapshot["warnings"] = [];
  if (input.requiredCertifications.length) {
    const rows = await client.query(
      `SELECT c.name,c.vendor_verified_at,c.expiration_date::text AS expiration_date
      FROM employee_certifications c JOIN vendor_people vp ON vp.id=c.employee_id
      WHERE vp.user_id=$1 AND vp.vendor_id=$2 AND vp.deleted_at IS NULL AND c.deleted_at IS NULL`,
      [input.run.driverUserId, actor.companyId],
    );
    const today = input.policyAt.slice(0, 10);
    for (const requirement of input.requiredCertifications) {
      const evidence = rows.rows.filter((row) => row.name === requirement);
      const current = evidence.some(
        (row) =>
          row.vendor_verified_at &&
          (!row.expiration_date || row.expiration_date >= today),
      );
      if (!current)
        warnings.push({
          category: "driver_certification",
          requirement,
          reason: !evidence.length
            ? "missing"
            : evidence.some(
                  (row) =>
                    row.vendor_verified_at &&
                    row.expiration_date &&
                    row.expiration_date < today,
                )
              ? "expired"
              : "unverified",
        });
    }
  }
  const sites = await readFleetAuthoritySites(client, actor.companyId, {
    siteIds: input.run.siteIds,
  });
  for (const site of sites) {
    const authority = authorityFromFleetRelationship(
      site,
      actor.companyId,
      site.id,
    );
    if (
      authority.allowed &&
      authority.basis === "prior_approval_compliance_warning"
    )
      warnings.push({
        category: "commercial_approval",
        reason: "compliance_lapse",
        approvalSnapshotId: authority.approvalSnapshotId,
      });
  }
  const subjects=await readFleetRunComplianceCheckpoint(client,actor.companyId,input.run,input.policyAt,{pendingEvent:["start","submit_closeout"].includes(input.action)?{type:input.action,recordedAt:input.policyAt,...(input.capturedAt?{capturedAt:input.capturedAt}:{})}:undefined});
  if(subjects.some(subject=>subject.status==="red"))warnings.push({category:"regulatory_review",reason:"unverified"});
  const authority =
    input.run.linkedTicketId && !["cancel", "pause"].includes(input.action)
      ? await requireFleetRunCommercialAuthority(
          client,
          input.run,
          input.action === "office_submit" ? "office_submit" : "execute",
        )
      : undefined;
  return FleetActionPolicySnapshotSchema.parse({
    mode: "warn_only",
    status: warnings.length?"red":"green",
    subjects,
    evaluatedAt: input.policyAt,
    ...(authority ? { authoritySnapshotId: authority.approvalSnapshotId } : {}),
    warnings,
  });
}
