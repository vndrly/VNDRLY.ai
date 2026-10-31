import { describe, expect, it } from "vitest";
import { reviewedSubmission, submissionDigest, freezeTicketSubmission } from "./ticket-submissions";

describe("submitted proof identity", () => {
  const content = { revision: 2, submittedAt: "2026-10-30T12:00:00Z", submittedById: 9, ticketId: 41,
    jobId: 7, afe: "AFE-72", ticket: { vendor_id: 2 }, job: { id: 7 }, lineItems: [{ quantity: "2", unit_price: "100" }], notes: [], checkIns: [], gps: [], gate: null };
  const packet = { ...content, digest: submissionDigest(content) };
  const ticket = { id: 41, submission_revision: 2, proof_submissions: [packet] };
  it("requires the exact revision being reviewed", () => {
    expect(() => reviewedSubmission(ticket, 1)).toThrow("Reload");
    expect(() => reviewedSubmission(ticket, undefined)).toThrow("Reload");
    expect(reviewedSubmission(ticket, "2")?.afe).toBe("AFE-72");
  });
  it("detects changed AFE or charges", () => {
    expect(() => reviewedSubmission({ ...ticket, proof_submissions: [{ ...packet, afe: "OTHER" }] }, 2)).toThrow("integrity");
    expect(() => reviewedSubmission({ ...ticket, proof_submissions: [{ ...packet, lineItems: [] }] }, 2)).toThrow("integrity");
  });
  it("survives PostgreSQL object key reordering", () => {
    const reversed = Object.fromEntries(Object.entries(content).reverse());
    expect(submissionDigest(reversed as typeof content)).toBe(packet.digest);
  });
  it("does not manufacture historical proof", () => {
    expect(reviewedSubmission({ id: 41, submission_revision: 0 }, undefined)).toBeNull();
  });
  it("rejects missing accepted job billing authority before any write", async () => {
    let calls = 0;
    const tx = { execute: async () => ({ rows: ++calls === 1 ? [{ id: 41, engagement_job_offer_id: 7, vendor_id: 2, site_location_id: 3, work_type_id: 4 }] : [] }) };
    await expect(freezeTicketSubmission(tx, 41, 9)).rejects.toThrow("AFE");
    expect(calls).toBe(2);
  });
  it("freezes the job and creates the next revision without copying mutable prior history", async () => {
    const rows = [
      [{ id: 41, engagement_job_offer_id: 7, vendor_id: 2, site_location_id: 3, work_type_id: 4, notes: "Shift complete", submission_revision: 2, proof_submissions: [packet] }],
      [{ id: 7, scope_snapshot: { afeCode: "AFE-72" }, commercial_snapshot: { unitPrice: "100" } }],
      [{ id: 1, quantity: "2", unit_price: "100", description: "Gatekeeping" }],
      [{ id: 20, content: "[photo] /proof/image.jpg" }], [], [], [], [],
      [{ tool_output: { ticketId: 41, noteId: 20, sha256: "original-sha", objectPath: "/proof/image.jpg" } },
       { tool_output: { ticketId: 41, noteId: 99, sha256: "excluded-deleted-note" } }],
      [{ finance: { site: { id: 3, combinedTaxRate: "0.0825" }, vendor: { id: 2 }, partner: { id: 1 },
        workType: null, taxRate: null, vendorWorkType: null, partnerApproval: null, billing: { paymentTermsDays: 30 } } }], [],
    ];
    let calls = 0;
    const tx = { execute: async () => ({ rows: rows[calls++] ?? [] }) };
    const frozen = await freezeTicketSubmission(tx, 41, 9);
    expect(frozen).toMatchObject({ revision: 3, jobId: 7, afe: "AFE-72", ticketId: 41 });
    expect(frozen.ticket).not.toHaveProperty("proof_submissions");
    expect(reviewedSubmission({ id: 41, submission_revision: 3, proof_submissions: [frozen] }, 3)).toEqual(frozen);
    expect(frozen.finance?.site.combinedTaxRate).toBe("0.0825");
    expect(frozen.attachmentReceipts).toEqual([{ ticketId: 41, noteId: 20, sha256: "original-sha", objectPath: "/proof/image.jpg" }]);
    expect(calls).toBe(11);
  });
  it("rejects open crew time even when a caller tried to force submission", async () => {
    const rows = [
      [{ id: 41, engagement_job_offer_id: 7, vendor_id: 2, site_location_id: 3, work_type_id: 4 }],
      [{ id: 7, scope_snapshot: { afeCode: "AFE-72" } }], [{ id: 1 }], [{ id: 2 }],
      [{ id: 3, check_in_at: "2026-10-30T10:00:00Z", check_out_at: null }],
    ];
    let calls = 0;
    await expect(freezeTicketSubmission({ execute: async () => ({ rows: rows[calls++] ?? [] }) }, 41, 9)).rejects.toThrow("Close every crew session");
    expect(calls).toBe(5);
  });
});
