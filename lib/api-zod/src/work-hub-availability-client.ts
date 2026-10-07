import {
  WorkHubAvailabilityInputSchema,
  WorkHubAvailabilityReadSchema,
  WorkHubAvailabilityReadbackSchema,
  WorkHubAvailabilityReceiptSchema,
  type WorkHubAvailabilityInput,
} from "./work-hub-availability";
export type WorkHubAvailabilityAttempt = {
  userId: number;
  companyId: number;
  actorMembershipId: number;
  actorSessionVersion: number;
  body: WorkHubAvailabilityInput;
  commandFingerprint: string;
};
export class WorkHubAvailabilityAbsentConflict extends Error {}
function receipt(attempt: WorkHubAvailabilityAttempt, raw: unknown) {
  const r = WorkHubAvailabilityReceiptSchema.parse(raw),
    b = attempt.body;
  if (
    r.userId !== attempt.userId ||
    r.actorUserId !== attempt.userId ||
    r.companyId !== attempt.companyId ||
    r.actorMembershipId !== attempt.actorMembershipId ||
    r.actorSessionVersion !== attempt.actorSessionVersion ||
    r.operationId !== b.operationId ||
    r.commandFingerprint !== attempt.commandFingerprint ||
    r.previousFingerprint !== b.expectedFingerprint ||
    (b.recordId !== null && r.record.id !== b.recordId) ||
    r.record.startsAt !== new Date(b.window.plannedStartAt).toISOString() ||
    r.record.endsAt !== new Date(b.window.plannedEndAt).toISOString() ||
    r.record.available !== b.available ||
    r.record.recurring
  )
    throw Error("availability_receipt_mismatch");
  return r;
}
export async function submitWorkHubAvailabilityAttempt(
  attempt: WorkHubAvailabilityAttempt,
  deps: {
    request(
      method: "GET" | "POST",
      path: string,
      body?: unknown,
    ): Promise<unknown>;
    assertCurrent(): void;
  },
) {
  WorkHubAvailabilityInputSchema.parse(attempt.body);
  deps.assertCurrent();
  const base = "/api/work-hub/availability";
  const saved = WorkHubAvailabilityReadbackSchema.parse(
    await deps.request("GET", `${base}/operations/${attempt.body.operationId}`),
  );
  deps.assertCurrent();
  if (saved.receipt) return receipt(attempt, saved.receipt);
  const current = WorkHubAvailabilityReadSchema.parse(
    await deps.request("GET", base),
  );
  deps.assertCurrent();
  if (
    current.userId !== attempt.userId ||
    current.companyId !== attempt.companyId ||
    current.actorMembershipId !== attempt.actorMembershipId ||
    current.actorSessionVersion !== attempt.actorSessionVersion ||
    !current.canManage ||
    current.fingerprint !== attempt.body.expectedFingerprint
  )
    throw new WorkHubAvailabilityAbsentConflict("availability_changed");
  const result = await deps.request("POST", base, attempt.body);
  deps.assertCurrent();
  return receipt(attempt, result);
}
