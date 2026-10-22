import { describe, expect, it, vi } from "vitest";
import { submitWorkforceAttempt } from "./workforce-offer-client";

const attempt = { actorUserId: 7, vendorId: 1, shiftId: "11111111-1111-4111-8111-111111111111", input: { operationId: "22222222-2222-4222-8222-222222222222", expectedVersion: 2, workerUserId: 8 }, commandFingerprint: "a".repeat(64) };
const receipt = { operationId: attempt.input.operationId, actorUserId: 7, shiftId: attempt.shiftId, offerId: "33333333-3333-4333-8333-333333333333", workerUserId: 8, status: "pending", previousVersion: 2, resultingVersion: 2, assignmentRecorded: false, commandFingerprint: attempt.commandFingerprint, recordedAt: "2026-10-22T10:00:00Z" };
describe("workforce offer recovery", () => {
  it("recovers a committed offer after a lost response without sending another offer", async () => {
    const http = vi.fn().mockResolvedValueOnce({ receipt: null }).mockRejectedValueOnce(Error("response lost")).mockResolvedValueOnce({ receipt });
    await expect(submitWorkforceAttempt(attempt, http, async () => attempt.commandFingerprint)).rejects.toThrow("response lost");
    expect(await submitWorkforceAttempt(attempt, http, async () => attempt.commandFingerprint)).toEqual(receipt);
    expect(http.mock.calls.filter(([, method]) => method === "POST")).toHaveLength(1);
  });
  it("resends the exact original input only after verified absence", async () => {
    const http = vi.fn().mockResolvedValueOnce({ receipt: null }).mockResolvedValueOnce(receipt);
    await submitWorkforceAttempt(attempt, http, async () => attempt.commandFingerprint);
    expect(http.mock.calls[1]).toEqual([`/shifts/${attempt.shiftId}/offers`, "POST", attempt.input]);
  });
  it("never writes when readback is unavailable or the journal has changed", async () => {
    const http = vi.fn().mockRejectedValue(Error("unavailable"));
    await expect(submitWorkforceAttempt(attempt, http, async () => attempt.commandFingerprint)).rejects.toThrow();
    expect(http).toHaveBeenCalledTimes(1);
    await expect(submitWorkforceAttempt(attempt, http, async () => "b".repeat(64))).rejects.toThrow("workforce.journal_invalid");
    expect(http).toHaveBeenCalledTimes(1);
  });
  it("rejects another actor's receipt", async () => {
    const http = vi.fn().mockResolvedValue({ receipt: { ...receipt, actorUserId: 9 } });
    await expect(submitWorkforceAttempt(attempt, http, async () => attempt.commandFingerprint)).rejects.toThrow("workforce.receipt_mismatch");
  });
  it("only treats a definitive POST rejection as safe to discard", async () => {
    const http = vi.fn().mockResolvedValueOnce({ receipt: null }).mockRejectedValueOnce(Object.assign(Error("version conflict"), { status: 409 }));
    await expect(submitWorkforceAttempt(attempt, http, async () => attempt.commandFingerprint)).rejects.toMatchObject({ rejected: true });
    const unreadable = vi.fn().mockRejectedValue(Object.assign(Error("forbidden read"), { status: 403 }));
    await expect(submitWorkforceAttempt(attempt, unreadable, async () => attempt.commandFingerprint)).rejects.not.toHaveProperty("rejected");
  });
});
