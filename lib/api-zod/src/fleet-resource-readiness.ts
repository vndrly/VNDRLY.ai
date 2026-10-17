import { z } from "zod/v4";
import {
  FleetComplianceAssessmentSchema,
  FleetComplianceSubjectSchema,
  FleetPartnerComplianceSnapshotSchema,
  fleetComplianceSubjectKey,
  type FleetComplianceSubject,
  type FleetPartnerComplianceSnapshot,
} from "./fleet-compliance";
import type { FleetResources } from "./fleet";

export const FleetComplianceAssessmentsSchema = z
  .object({
    assessments: z.array(FleetComplianceAssessmentSchema),
    summaries: z.array(FleetPartnerComplianceSnapshotSchema),
    mode: z.literal("warn_only"),
  })
  .strict();
export type FleetResourceReadiness = {
  status: "green" | "red";
  reasons: Array<
    "missing" | "expired" | "revoked" | "failed" | "unverified" | "excluded"
  >;
  evaluatedAt: string | null;
};
/** Operational display only: this is neither HOS clearance nor a dispatch
 * availability decision. Every selected canonical component must be present. */
export function fleetResourceReadiness(
  subjects: readonly FleetComplianceSubject[],
  raw: readonly FleetPartnerComplianceSnapshot[],
): FleetResourceReadiness {
  const selected = subjects.map((subject) =>
      FleetComplianceSubjectSchema.parse(subject),
    ),
    summaries = raw.map((row) =>
      FleetPartnerComplianceSnapshotSchema.parse(row),
    );
  const reasons = new Set<FleetResourceReadiness["reasons"][number]>(),
    times: string[] = [];
  if (!selected.length) reasons.add("unverified");
  for (const subject of selected) {
    const rows = summaries.filter(
      (row) =>
        fleetComplianceSubjectKey(row.subject) ===
        fleetComplianceSubjectKey(subject),
    );
    if (rows.length !== 1) {
      reasons.add("unverified");
      continue;
    }
    const row = rows[0]!;
    times.push(row.evaluatedAt);
    if (row.freshness !== "current") reasons.add("unverified");
    row.reasons.forEach((reason) => reasons.add(reason.reason));
    if (row.status !== "green" && !row.reasons.length)
      reasons.add("unverified");
  }
  return {
    status: reasons.size ? "red" : "green",
    reasons: [...reasons],
    evaluatedAt: times.length
      ? times.sort((a, b) => Date.parse(a) - Date.parse(b))[0]!
      : null,
  };
}
export function fleetResourceComplianceSubjects(
  resources: Pick<FleetResources, "drivers" | "equipment">,
): FleetComplianceSubject[] {
  return [
    ...new Map(
      [
        ...resources.drivers.map((driver) => ({
          kind: "driver" as const,
          id: driver.userId,
        })),
        ...resources.equipment.map((asset) => ({
          kind: ["vehicle", "truck"].includes(asset.category)
            ? ("vehicle" as const)
            : ("component" as const),
          id: asset.id,
        })),
      ].map((subject) => [fleetComplianceSubjectKey(subject), subject]),
    ).values(),
  ];
}
export function fleetResourceReadinessIndex(
  subjects: readonly FleetComplianceSubject[],
  summaries: readonly FleetPartnerComplianceSnapshot[],
): Record<string, FleetResourceReadiness> {
  return Object.fromEntries(
    subjects.map((subject) => [
      fleetComplianceSubjectKey(subject),
      fleetResourceReadiness([subject], summaries),
    ]),
  );
}
