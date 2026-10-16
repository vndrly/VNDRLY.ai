import { z } from "zod/v4";

/** Safe immutable checkpoint summary. Private document payloads never belong here. */
export const FleetActionPolicySnapshotSchema = z
  .object({
    mode: z.literal("warn_only"),
    status: z.enum(["green", "red"]),
    evaluatedAt: z.iso.datetime({ offset: true }),
    authoritySnapshotId: z.string().max(160).optional(),
    warnings: z.array(
      z
        .object({
          category: z.enum([
            "driver_certification",
            "commercial_approval",
            "regulatory_review",
          ]),
          reason: z.enum([
            "missing",
            "expired",
            "unverified",
            "compliance_lapse",
          ]),
          requirement: z.string().max(100).optional(),
          approvalSnapshotId: z.string().max(160).optional(),
        })
        .strict(),
    ),
  })
  .strict();
export type FleetActionPolicySnapshot = z.infer<
  typeof FleetActionPolicySnapshotSchema
>;

export const FleetComplianceCheckpointSchema = z
  .object({
    action: z.string(),
    recordedAt: z.iso.datetime({ offset: true }),
    mode: z.literal("warn_only"),
    status: z.enum(["green", "red"]),
    reasons: z.array(
      z
        .object({
          category: z.enum([
            "driver_certification",
            "commercial_approval",
            "regulatory_review",
          ]),
          reason: z.enum([
            "missing",
            "expired",
            "unverified",
            "compliance_lapse",
          ]),
        })
        .strict(),
    ),
  })
  .strict();
export type FleetComplianceCheckpoint = z.infer<
  typeof FleetComplianceCheckpointSchema
>;
export function projectFleetComplianceCheckpoints(
  events: Array<{
    type: string;
    recordedAt: string;
    details?: Record<string, unknown>;
  }>,
) {
  return events.flatMap((event) => {
    const parsed = FleetActionPolicySnapshotSchema.safeParse(
      event.details?.fleetCompliance,
    );
    if (!parsed.success) return [];
    return [
      FleetComplianceCheckpointSchema.parse({
        action: event.type,
        recordedAt: event.recordedAt,
        mode: parsed.data.mode,
        status: parsed.data.status,
        reasons: parsed.data.warnings.map(({ category, reason }) => ({
          category,
          reason,
        })),
      }),
    ];
  });
}
