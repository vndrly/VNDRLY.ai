import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { canShowWorkforce, fingerprintWorkforceAttempt, submitWorkforceAttempt, workforceCandidateEligible } from "./workforce-offer-client";
vi.mock("expo-crypto", () => ({ CryptoDigestAlgorithm: { SHA256: "SHA-256" }, digestStringAsync: async (_: string, value: string) => createHash("sha256").update(value).digest("hex") }));
const shiftId = "10000000-0000-4000-8000-000000000001", operationId = "10000000-0000-4000-8000-000000000002", offerId = "10000000-0000-4000-8000-000000000003";
const base = { actorUserId: 6, vendorId: 11, shiftId, input: { operationId, expectedVersion: 2, workerUserId: 8 } };
let attempt: any, receipt: any;
beforeEach(async () => {
  attempt = { ...base, commandFingerprint: await fingerprintWorkforceAttempt(base) };
  receipt = { operationId, actorUserId: 6, shiftId, offerId, workerUserId: 8, status: "pending", previousVersion: 2, resultingVersion: 3, assignmentRecorded: false, commandFingerprint: attempt.commandFingerprint, recordedAt: "2026-10-22T12:00:00Z" };
});
describe("native workforce offer recovery", () => {
  it("uses the original operation receipt without sending another offer", async () => {
    const calls: string[] = [];
    const result = await submitWorkforceAttempt(attempt, async (path, method) => { calls.push(method + " " + path); return { receipt }; });
    expect(result.assignmentRecorded).toBe(false);
    expect(calls).toEqual([`GET /shifts/${shiftId}/offers/operations/${operationId}`]);
  });
  it("does not resend when operation readback fails", async () => {
    const methods: string[] = [];
    await expect(submitWorkforceAttempt(attempt, async (_, method) => { methods.push(method); throw Error("offline"); })).rejects.toThrow("offline");
    expect(methods).toEqual(["GET"]);
  });
  it("retries only the saved operation after confirmed absence", async () => {
    let sent: unknown;
    const result = await submitWorkforceAttempt(attempt, async (_, method, body) => { if (method === "GET") return { receipt: null }; sent = body; return receipt; });
    expect(sent).toEqual({ operationId, expectedVersion: 2, workerUserId: 8 });
    expect(result.status).toBe("pending");
  });
  it("rejects a different actor receipt and a tampered saved request", async () => {
    await expect(submitWorkforceAttempt(attempt, async () => ({ receipt: { ...receipt, actorUserId: 99 } }))).rejects.toThrow("receipt_mismatch");
    await expect(submitWorkforceAttempt({ ...attempt, input: { ...attempt.input, workerUserId: 99 } }, async () => ({ receipt }))).rejects.toThrow("journal_invalid");
  });
});
it("limits the card to current vendor gate capabilities and company type", () => {
  expect(canShowWorkforce({ role: "vendor", vendorId: 11, vendorRole: "office" }, ["gate"])).toBe(true);
  expect(canShowWorkforce({ role: "vendor", vendorId: 11, vendorRole: "office" }, ["field"])).toBe(false);
  expect(canShowWorkforce({ role: "field_employee", vendorId: 11, vendorRole: "field" }, ["gate"])).toBe(false);
  expect(canShowWorkforce({ role: "partner", vendorId: 11 }, ["gate"], { orgType: "partner", role: "admin" })).toBe(false);
  expect(canShowWorkforce({ role: "vendor", vendorId: 11 }, ["gate"], { orgType: "vendor", orgId: 22, role: "admin" })).toBe(false);
});
it("never treats unknown availability or unverified requirements as offer eligibility", () => {
  const person: any = { qualificationState: "recorded_requirements_verified", availability: "recorded_available", eligibility: { allowed: true, overrideRequired: false }, requirements: [{ currentRecorded: true, vendorVerified: true }] };
  const evidence: any = { qualificationConfiguration: "configured" };
  expect(workforceCandidateEligible(evidence, person)).toBe(true);
  expect(workforceCandidateEligible(evidence, { ...person, availability: "unknown_no_window" })).toBe(false);
  expect(workforceCandidateEligible({ qualificationConfiguration: "unknown" } as any, person)).toBe(false);
  expect(workforceCandidateEligible(evidence, { ...person, requirements: [{ currentRecorded: true, vendorVerified: false }] })).toBe(false);
});
