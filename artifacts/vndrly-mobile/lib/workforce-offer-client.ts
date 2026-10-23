import * as Crypto from "expo-crypto";
import type { StoredUser } from "./auth";
import type { GateShiftStaffingCandidates } from "@workspace/api-zod";
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
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify(values));
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

export function canShowWorkforce(user: Pick<StoredUser, "role" | "vendorId" | "vendorRole" | "managedSubcontractor"> | null | undefined, categories: readonly string[], membership?: { orgType?: string; orgId?: number; role?: string } | null) {
  if (!user?.vendorId || user.role === "partner" || membership?.orgType === "partner" || membership?.orgType === "vendor" && membership.orgId != null && membership.orgId !== user.vendorId) return false;
  if (user.managedSubcontractor) return user.managedSubcontractor.siteGrants.length > 0;
  return categories.includes("gate") && (user.role === "admin" || membership?.role === "admin" || ["gatekeeper", "gate_supervisor"].includes(user.vendorRole ?? "") || user.role === "vendor" && [null, "office", "both"].includes(user.vendorRole ?? null));
}
export function workforceCandidateEligible(evidence: GateShiftStaffingCandidates, person: GateShiftStaffingCandidates["candidates"][number]) {
  return evidence.qualificationConfiguration !== "unknown" && person.qualificationState !== "missing_or_unverified" && person.availability === "recorded_available" && person.eligibility.allowed && !person.eligibility.overrideRequired && person.requirements.every(requirement => requirement.currentRecorded && requirement.vendorVerified);
}
