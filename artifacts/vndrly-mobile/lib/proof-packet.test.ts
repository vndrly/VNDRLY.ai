import { describe, expect, it } from "vitest";

import { buildTicketProofPacket, fieldProofPacket } from "./proof-packet";

const completeTicket = {
  status: "funds_dispersed",
  notes: "No issues on location.",
  checkInTime: "2026-08-17T14:00:00.000Z",
  checkOutTime: "2026-08-17T18:30:00.000Z",
  checkInLatitude: 31.997,
  checkInLongitude: -102.077,
  checkOutLatitude: 31.998,
  checkOutLongitude: -102.078,
  siteLatitude: 31.9972,
  siteLongitude: -102.0772,
  startingMileage: "10234.1",
  endingMileage: "10288.6",
  approvedAt: "2026-08-17T20:00:00.000Z",
  paymentDispersedAt: "2026-08-18T15:00:00.000Z",
  paymentReference: "ACH-9911",
};

describe("mobile buildTicketProofPacket", () => {
  it("summarizes complete proof-to-pay evidence for a dispersed ticket", () => {
    const packet = buildTicketProofPacket(
      completeTicket,
      [
        { type: "labor_regular", quantity: "4.5", unitPrice: "125.00" },
        { type: "parts", quantity: "2", unitPrice: "35.00" },
      ],
      [{ content: "Photo attached", attachments: ["/objects/uploads/photo.jpg"] }],
    );

    expect(packet.status).toBe("complete");
    expect(packet.completedCount).toBe(5);
    expect(packet.totalCount).toBe(5);
    expect(packet.sections.map((section) => section.id)).toEqual([
      "gps_time",
      "field_notes",
      "mileage",
      "cost",
      "approval",
      "payment",
    ]);
    expect(packet.sections.find((section) => section.id === "field_notes")?.detail)
      .toBe("2 note source(s), 1 attachment(s)");
    expect(packet.sections.find((section) => section.id === "cost")?.detail)
      .toBe("$632.50 captured");
  });

  it("names missing evidence for an incomplete ticket", () => {
    const packet = buildTicketProofPacket(
      {
        ...completeTicket,
        status: "pending_review",
        notes: null,
        checkOutTime: null,
        checkOutLatitude: null,
        checkOutLongitude: null,
        endingMileage: null,
        approvedAt: null,
        paymentDispersedAt: null,
        paymentReference: null,
      },
      [],
      [],
    );

    expect(packet.status).toBe("needs_attention");
    expect(packet.missingEvidence).toEqual([
      "checkout GPS/time",
      "field notes/photos",
      "parts/labor/equipment line items",
      "partner/admin approval",
      "payment record",
    ]);
  });
});

it("keeps mileage optional and field handoff separate from approval and payment", () => {
  const full = buildTicketProofPacket({...completeTicket, startingMileage:null, endingMileage:null});
  expect(full.missingEvidence).not.toContain("starting mileage");
  const submitted = fieldProofPacket(full, "submitted");
  expect(submitted.sections.some(s => s.id === "approval" || s.id === "payment")).toBe(false);
  expect(submitted.sections.find(s => s.id === "submission")?.complete).toBe(true);
  expect(fieldProofPacket(full, "kicked_back").missingEvidence).toContain("requested corrections and resubmission");
});
