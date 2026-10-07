import {
  GateShiftAssignmentInputSchema,
  GateShiftAssignmentReadbackSchema,
  GateShiftAssignmentReceiptSchema,
  GateShiftStaffingCandidatesSchema,
  gateShiftAssignmentFingerprintValues,
  type GateShiftAssignmentInput,
  type GateShiftStaffingCandidates,
} from "@workspace/api-zod";

export function assignableGateCandidate(
  snapshot: GateShiftStaffingCandidates,
  candidate: GateShiftStaffingCandidates["candidates"][number],
) {
  return (
    snapshot.qualificationConfiguration !== "unknown" &&
    (snapshot.qualificationConfiguration === "none_configured" ||
      (candidate.qualificationState === "recorded_requirements_verified" &&
        candidate.requirements.every(
          (r) => r.currentRecorded && r.vendorVerified,
        ))) &&
    candidate.availability === "recorded_available" &&
    candidate.eligibility.allowed &&
    !candidate.eligibility.overrideRequired &&
    candidate.eligibility.warnings.length === 0
  );
}
export type GateAssignmentAttempt = Readonly<{
  shiftId: string;
  actorUserId: number;
  input: GateShiftAssignmentInput;
  fingerprint: string;
  body: string;
  names: readonly string[];
  startsAt: string;
  endsAt: string;
  timezone: string;
}>;
export async function prepareGateAssignment(
  raw: unknown,
  ids: number[],
  operationId: string,
  actorUserId: number,
  vendorId: number,
  digest: (text: string) => Promise<string>,
): Promise<GateAssignmentAttempt> {
  const snapshot = GateShiftStaffingCandidatesSchema.parse(raw);
  const selected = [...new Set(ids)].sort((a, b) => a - b);
  if (
    !selected.length ||
    selected.some(
      (id) =>
        !snapshot.candidates.some(
          (c) => c.userId === id && assignableGateCandidate(snapshot, c),
        ),
    )
  )
    throw Error("candidate_not_eligible");
  const input = GateShiftAssignmentInputSchema.parse({
    operationId,
    expectedVersion: snapshot.shiftVersion,
    assigneeUserIds: selected,
  });
  const fingerprint = await digest(
    JSON.stringify(
      gateShiftAssignmentFingerprintValues(
        snapshot.shiftId,
        actorUserId,
        vendorId,
        input,
      ),
    ),
  );
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw Error("invalid_fingerprint");
  return Object.freeze({
    startsAt: snapshot.startsAt,
    endsAt: snapshot.endsAt,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    shiftId: snapshot.shiftId,
    actorUserId,
    input: Object.freeze({
      ...input,
      assigneeUserIds: Object.freeze(selected) as unknown as number[],
    }),
    fingerprint,
    body: JSON.stringify(input),
    names: Object.freeze(
      selected.map(
        (id) => snapshot.candidates.find((c) => c.userId === id)!.name,
      ),
    ),
  });
}
export class GateAssignmentChanged extends Error {}
export async function submitGateAssignment(
  attempt: GateAssignmentAttempt,
  api: (
    path: string,
    init?: { method: string; body: string },
  ) => Promise<unknown>,
  current: () => boolean,
) {
  const path = `/api/work-hub/shifts/${attempt.shiftId}`;
  const check = () => {
    if (!current()) throw Error("account_changed");
  };
  const receipt = (raw: unknown) => {
    const r = GateShiftAssignmentReceiptSchema.parse(raw);
    if (
      r.shiftId !== attempt.shiftId ||
      r.actorUserId !== attempt.actorUserId ||
      r.operationId !== attempt.input.operationId ||
      r.previousVersion !== attempt.input.expectedVersion ||
      r.resultingVersion !== r.previousVersion + 1 ||
      r.commandFingerprint !== attempt.fingerprint ||
      JSON.stringify(r.assigneeUserIds) !==
        JSON.stringify(attempt.input.assigneeUserIds)
    )
      throw Error("receipt_mismatch");
    return r;
  };
  check();
  const prior = GateShiftAssignmentReadbackSchema.parse(
    await api(path + `/assignments/operations/${attempt.input.operationId}`),
  );
  check();
  if (prior.receipt) return receipt(prior.receipt);
  const choices = GateShiftStaffingCandidatesSchema.parse(
    await api(path + "/staffing-candidates"),
  );
  check();
  if (
    choices.shiftId !== attempt.shiftId ||
    choices.shiftVersion !== attempt.input.expectedVersion ||
    attempt.input.assigneeUserIds.some(
      (id) =>
        !choices.candidates.some(
          (c) => c.userId === id && assignableGateCandidate(choices, c),
        ),
    )
  )
    throw new GateAssignmentChanged("assignment_review_changed");
  const saved = await api(path + "/assignments", {
    method: "POST",
    body: attempt.body,
  });
  check();
  return receipt(saved);
}
