import { describe, expect, it } from "vitest";

import { buildTicketProofPacket } from "./ticket-proof-packet";

const baseTicket = {
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
  siteRadiusMeters: 500,
  startingMileage: "10234.1",
  endingMileage: "10288.6",
  approvedAt: "2026-08-17T20:00:00.000Z",
  paymentDispersedAt: "2026-08-18T15:00:00.000Z",
  paymentReference: "ACH-9911",
};

const lineItems = [
  { type: "labor_regular", quantity: "4.5", unitPrice: "125.00" },
  { type: "parts", quantity: "2", unitPrice: "35.00" },
];

describe("buildTicketProofPacket", () => {
  it("marks a fully documented dispersed ticket as complete", () => {
    const packet = buildTicketProofPacket(baseTicket, lineItems);

    expect(packet.status).toBe("complete");
    expect(packet.completedCount).toBe(packet.totalCount);
    expect(packet.sections.map((section) => section.id)).toEqual([
      "gps_time",
      "field_notes",
      "mileage",
      "cost",
      "approval",
      "payment",
    ]);
    expect(packet.sections.every((section) => section.complete)).toBe(true);
    expect(packet.sections.find((section) => section.id === "mileage")?.detail)
      .toBe("54.5 mi logged");
    expect(packet.sections.find((section) => section.id === "cost")?.detail)
      .toBe("$632.50 captured");
    expect(packet.lineItemTotal).toBe(632.5);
  });

  it("names the missing evidence for a ticket that is not ready to defend", () => {
    const packet = buildTicketProofPacket(
      {
        ...baseTicket,
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
    );

    expect(packet.status).toBe("needs_attention");
    expect(packet.completedCount).toBe(0);
    expect(packet.missingEvidence).toEqual([
      "checkout GPS/time",
      "field notes/photos",
      "parts/labor/equipment line items",
      "partner/admin approval",
      "payment record",
    ]);
  });
});
it("sums reviewed payable cents exactly before converting the partner packet total to a number",()=>{
 const rows=Array.from({length:500},(_,index)=>({type:"other",quantity:"123.46",unitPrice:"0.00",fleetBillingMetadata:{version:2,charge:{id:`11111111-1111-4111-8111-${String(index+1).padStart(12,"0")}`,revision:1,quantity:"123.456789",unitRate:"0.000125",exactAmount:"0.015432098625",currencyAmount:"0.02",currency:"USD",reviewedByUserId:7,reviewedAt:"2026-10-17T18:00:00Z"}}}));
 const packet=buildTicketProofPacket(baseTicket,[...rows,{type:"parts",quantity:"1",unitPrice:"2.50"}]);expect(packet.lineItemTotal).toBe(12.5);expect(packet.sections.find(section=>section.id==="cost")?.detail).toBe("$12.50 captured");
});
