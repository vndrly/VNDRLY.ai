import React from "react";
import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TicketSubmittedProof, type ProofHistory, type SubmittedProof } from "./ticket-submitted-proof";

const packet = (revision: number, afe: string): SubmittedProof => ({
  revision, submittedAt: "2026-10-31T00:00:00Z", submittedById: 8, ticketId: 123, jobId: 91, afe, digest: `saved-reference-${revision}`,
  ticket: { notes: `Office note revision ${revision}` }, job: { scope_snapshot: { scope: "Gatekeeping day shift" } },
  lineItems: [{ id: 1, description: "Gatekeeper shift", precise_quantity: "12.0000", precise_unit_price: "25.0000" }],
  notes: [{ id: 2, content: `Saved field evidence revision ${revision}`, attachments: ["https://example.invalid/proof.jpg"] }],
  checkIns: [{ id: 9 }], gps: [{ latitude: 35, longitude: -97 }], gate: { coveredMinutes: 720 },
});
const history: ProofHistory = { jobId: 91, revision: 2, approvedRevision: 1, submissions: [packet(1, "AFE-ORIGINAL"), packet(2, "AFE-CORRECTED")] };
it("shows the saved job, AFE, charges and evidence of the current submission", () => {
  render(<TicketSubmittedProof history={history} />);
  expect(screen.getByText("Submitted proof sheet · Ticket #123")).toBeTruthy();
  expect(screen.getByText("Job #91 · AFE AFE-CORRECTED")).toBeTruthy();
  expect(screen.getByText("Gatekeeper shift")).toBeTruthy();
  expect(screen.getByText("12.0000")).toBeTruthy();
  expect(screen.getByText("25.0000")).toBeTruthy();
  expect(screen.getByText("Office note revision 2")).toBeTruthy();
  expect(screen.getByText("Saved field evidence revision 2")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Attachment 1" }).getAttribute("href")).toBe("https://example.invalid/proof.jpg");
  expect(screen.getByText(/Gate coverage included/)).toBeTruthy();
});
it("switches to the exact historical submission and tells the reviewer which revision is selected", () => {
  const selected = vi.fn();
  render(<TicketSubmittedProof history={history} onRevisionChange={selected} />);
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "1" } });
  expect(selected).toHaveBeenCalledWith(1);
  expect(screen.getByText("Job #91 · AFE AFE-ORIGINAL")).toBeTruthy();
  expect(screen.getByText("Saved field evidence revision 1")).toBeTruthy();
  expect(screen.queryByText("Saved field evidence revision 2")).toBeNull();
  expect(screen.getByRole("option", { name: "1 · Approved" })).toBeTruthy();
});
it("does not fabricate a proof sheet before the job ticket is submitted", () => {
  render(<TicketSubmittedProof history={{ jobId: 91, revision: 0, approvedRevision: null, submissions: [] }} />);
  expect(screen.queryByTestId("submitted-proof-sheet")).toBeNull();
  expect(screen.getByText(/will be saved when this ticket is submitted/)).toBeTruthy();
});
