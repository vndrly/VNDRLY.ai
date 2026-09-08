import { describe, expect, it } from "vitest";
import { missingVendorApprovalFields } from "./vendor-approval-readiness";

const today = new Date("2026-09-07T18:00:00Z");
const ready = { federalTaxId: "on-file", coiDocumentUrl: "/private/coi.pdf", insuranceExpirationDate: "2026-09-07" };
describe("approval readiness without catalog publishing", () => {
  it("requires the original minimum tax and insurance fields", () => {
    expect(missingVendorApprovalFields({ federalTaxId: null, coiDocumentUrl: " ", insuranceExpirationDate: null }, today))
      .toEqual(["federalTaxId", "coiDocumentUrl", "insuranceExpirationDate"]);
  });
  it("accepts complete current insurance independently of publication", () => {
    expect(missingVendorApprovalFields(ready, today)).toEqual([]);
  });
  it("rejects expired and invalid insurance dates", () => {
    for (const insuranceExpirationDate of ["2026-09-06", "invalid", "2028-02-31"]) {
      expect(missingVendorApprovalFields({ ...ready, insuranceExpirationDate }, today)).toEqual(["insuranceExpirationDate"]);
    }
  });
});
