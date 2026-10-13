import { expect, it } from "vitest";
import { buildTicketProofPacket, fieldProofPacket } from "./proof-packet";
it("field proof hides office approval and payment while preserving optional mileage", () => {
  const packet = fieldProofPacket(buildTicketProofPacket({ status: "submitted" }), "submitted");
  expect(packet.sections.map(section => section.id)).toEqual(["gps_time", "field_notes", "mileage", "cost", "submission"]);
  expect(packet.sections.find(section => section.id === "submission")?.complete).toBe(true);
  expect(packet.missingEvidence).not.toContain("starting mileage");
  expect(packet.totalCount).toBe(4);
});
it("kickback requires corrections and resubmission, not office payment", () => {
  const packet = fieldProofPacket(buildTicketProofPacket({}), "kicked_back");
  expect(packet.missingEvidence).toContain("requested corrections and resubmission");
  expect(packet.sections.find(section => section.id === "submission")?.detail).toContain("resubmit");
});
