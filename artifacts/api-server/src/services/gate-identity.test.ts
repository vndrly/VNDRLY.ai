import { describe, it, expect } from "vitest";
import { GateIdentityInput, gateIdentityDeadline } from "./gate-identity";
describe("Gate reviewed identity", () => {
  it("requires explicit review and minimal retained document fields", () => {
    const input = {
      operationId: "11111111-1111-4111-8111-111111111111",
      objectPath: "/objects/uploads/11111111-1111-4111-8111-111111111111",
      capturedAt: "2026-10-07T00:00:00Z",
      reviewConfirmed: true,
      source: "visionkit_document_scan",
      fields: {
        firstName: "Synthetic",
        lastName: "Visitor",
        documentType: "ID",
        issuingRegion: "TEST",
      },
    };
    expect(GateIdentityInput.safeParse(input).success).toBe(true);
    expect(
      GateIdentityInput.safeParse({ ...input, source: "camera_manual_review" })
        .success,
    ).toBe(true);
    expect(
      GateIdentityInput.safeParse({ ...input, reviewConfirmed: false }).success,
    ).toBe(false);
    expect(
      GateIdentityInput.safeParse({
        ...input,
        fields: { ...input.fields, documentNumber: "sensitive-full-id" },
      }).success,
    ).toBe(false);
  });
  it("bounds images thirty days after reported close and entry while still open", () => {
    expect(
      gateIdentityDeadline({
        check_in_time: "2026-01-01T00:00:00Z",
      }).toISOString(),
    ).toBe("2026-01-31T00:00:00.000Z");
    expect(
      gateIdentityDeadline({
        check_in_time: "2026-01-01T00:00:00Z",
        check_out_time: "2026-01-02T00:00:00Z",
      }).toISOString(),
    ).toBe("2026-02-01T00:00:00.000Z");
  });
});
