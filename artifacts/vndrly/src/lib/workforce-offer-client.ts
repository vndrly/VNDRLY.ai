import { WorkforceOfferInputSchema, WorkforceOfferResponseInputSchema, WorkforceOfferReceiptSchema, workforceOfferFingerprintValues, workforceOfferResponseFingerprintValues } from "@workspace/api-zod";
import { z } from "zod/v4";

export const WorkforceAttemptSchema = z.object({
  actorUserId: z.number().int().positive(), vendorId: z.number().int().positive(), shiftId: z.uuid(), offerId: z.uuid().optional(),
  input: z.union([WorkforceOfferInputSchema, WorkforceOfferResponseInputSchema]), commandFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().refine(value => Boolean(value.offerId) === ("decision" in value.input));
export type WorkforceAttempt = z.infer<typeof WorkforceAttemptSchema>;
export async function fingerprintWorkforceAttempt(attempt: Omit<WorkforceAttempt, "commandFingerprint">): Promise<string> {
  const values = "decision" in attempt.input
    ? workforceOfferResponseFingerprintValues(attempt.shiftId, attempt.offerId!, attempt.actorUserId, attempt.vendorId, attempt.input)
    : workforceOfferFingerprintValues(attempt.shiftId, attempt.actorUserId, attempt.vendorId, attempt.input);
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(values)));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Verify the original saved request before any resend; failed readback never means absence. */
export async function submitWorkforceAttempt(
  value: WorkforceAttempt,
  http: (path: string, method: "GET" | "POST", body?: unknown) => Promise<unknown>,
  fingerprint = fingerprintWorkforceAttempt,
) {
  const attempt = WorkforceAttemptSchema.parse(value);
  if (await fingerprint(attempt) !== attempt.commandFingerprint) throw Error("workforce.journal_invalid");
  const base = `/shifts/${encodeURIComponent(attempt.shiftId)}/offers`;
  const readback = z.object({ receipt: WorkforceOfferReceiptSchema.nullable() }).strict().parse(await http(`${base}/operations/${attempt.input.operationId}`, "GET"));
  let receipt = readback.receipt;
  if (!receipt) {
    try { receipt = WorkforceOfferReceiptSchema.parse(await http(attempt.offerId ? `${base}/${attempt.offerId}/respond` : base, "POST", attempt.input)); }
    catch (error) {
      // A complete validation/access/conflict response confirms rollback. Network failures do not.
      if ([400, 403, 409].includes((error as { status?: number })?.status ?? 0)) throw Object.assign(Error("workforce.request_rejected"), { rejected: true });
      throw error;
    }
  }
  const worker = "workerUserId" in attempt.input ? attempt.input.workerUserId : attempt.actorUserId;
  if (receipt.operationId !== attempt.input.operationId || receipt.actorUserId !== attempt.actorUserId || receipt.shiftId !== attempt.shiftId || receipt.workerUserId !== worker || receipt.commandFingerprint !== attempt.commandFingerprint || attempt.offerId && receipt.offerId !== attempt.offerId) throw Error("workforce.receipt_mismatch");
  return receipt;
}
