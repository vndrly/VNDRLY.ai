import { z } from "zod/v4";
import {
  WorkHubShiftOpeningInputSchema,
  WorkHubShiftOpeningReceiptSchema,
  WorkHubShiftOpeningReadbackSchema,
  workHubShiftOpeningFingerprintValues,
  type WorkHubShiftOpeningInput,
} from "./work-hub-shift-opening";
export type WorkHubShiftOpeningAttempt = {
  actorUserId: number;
  shiftId: string;
  owner: { type: "vendor" | "partner"; id: number };
  context: { kind: "gate" | "organization"; id: number };
  input: WorkHubShiftOpeningInput;
  commandFingerprint: string;
};
export const WorkHubShiftOpeningAttemptSchema = z
  .object({
    actorUserId: z.number().int().positive(),
    shiftId: z.uuid(),
    owner: z
      .object({
        type: z.enum(["vendor", "partner"]),
        id: z.number().int().positive(),
      })
      .strict(),
    context: z
      .object({
        kind: z.enum(["gate", "organization"]),
        id: z.number().int().positive(),
      })
      .strict(),
    input: WorkHubShiftOpeningInputSchema,
    commandFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export async function validateWorkHubShiftOpeningAttempt(
  raw: unknown,
  hash: (value: string) => string | Promise<string>,
) {
  const attempt = WorkHubShiftOpeningAttemptSchema.parse(raw);
  const expected = await hash(
    JSON.stringify(
      workHubShiftOpeningFingerprintValues(
        attempt.shiftId,
        attempt.actorUserId,
        attempt.owner.type,
        attempt.owner.id,
        attempt.input,
      ),
    ),
  );
  if (expected !== attempt.commandFingerprint)
    throw Error("shift_opening_attempt_mismatch");
  return attempt;
}
export function makeWorkHubShiftOpeningAttempt(
  raw: Omit<WorkHubShiftOpeningAttempt, "commandFingerprint">,
  hash: (value: string) => string,
): WorkHubShiftOpeningAttempt {
  z.uuid().parse(raw.shiftId);
  z.number().int().positive().parse(raw.actorUserId);
  z.number().int().positive().parse(raw.owner.id);
  z.number().int().positive().parse(raw.context.id);
  const input = WorkHubShiftOpeningInputSchema.parse(raw.input);
  return {
    ...raw,
    input,
    commandFingerprint: hash(
      JSON.stringify(
        workHubShiftOpeningFingerprintValues(
          raw.shiftId,
          raw.actorUserId,
          raw.owner.type,
          raw.owner.id,
          input,
        ),
      ),
    ),
  };
}
export function exactWorkHubShiftOpeningReceipt(
  attempt: WorkHubShiftOpeningAttempt,
  raw: unknown,
) {
  const r = WorkHubShiftOpeningReceiptSchema.parse(raw);
  if (
    r.operationId !== attempt.input.operationId ||
    r.actorUserId !== attempt.actorUserId ||
    r.shiftId !== attempt.shiftId ||
    r.ownerOrgType !== attempt.owner.type ||
    r.ownerOrgId !== attempt.owner.id ||
    r.previousVersion !== attempt.input.expectedVersion ||
    r.resultingVersion !== r.previousVersion + 1 ||
    r.open !== attempt.input.open ||
    r.commandFingerprint !== attempt.commandFingerprint
  )
    throw Error("shift_opening_receipt_mismatch");
  return r;
}
export async function submitWorkHubShiftOpeningAttempt(
  attempt: WorkHubShiftOpeningAttempt,
  http: (
    path: string,
    method: "GET" | "PATCH",
    body?: unknown,
  ) => Promise<unknown>,
  hash: (value: string) => string | Promise<string>,
) {
  attempt = await validateWorkHubShiftOpeningAttempt(attempt, hash);
  const path = `/work-hub/shifts/${attempt.shiftId}`;
  const prior = WorkHubShiftOpeningReadbackSchema.parse(
    await http(`${path}/open/operations/${attempt.input.operationId}`, "GET"),
  );
  if (prior.receipt)
    return exactWorkHubShiftOpeningReceipt(attempt, prior.receipt);
  // A null receipt authorizes only the original reviewed body. Server rechecks
  // current membership, exact version and future unassigned planning state.
  const raw = await http(path, "PATCH", {
    operationId: attempt.input.operationId,
    owner: attempt.owner,
    context: attempt.context,
    expectedVersion: attempt.input.expectedVersion,
    payloadVersion: 1,
    payload: { action: "update", open: attempt.input.open },
  });
  return exactWorkHubShiftOpeningReceipt(attempt, raw);
}
