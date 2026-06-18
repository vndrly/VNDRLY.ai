import { describe, expect, it } from "vitest";
import {
  formatSendToDetail,
  humanizeDisplayName,
  personHeadline,
  sendToRowKey,
} from "./send-to-display";

describe("send-to-display", () => {
  it("builds stable row keys per group", () => {
    expect(sendToRowKey("on_ticket", 750)).toBe("on_ticket:750");
    expect(sendToRowKey("vendor_poc_field", 750)).toBe("vendor_poc_field:750");
  });

  it("humanizes void-audit test display names", () => {
    expect(
      humanizeDisplayName("void-audit-1780647677647-kybu0d-Vendor Admin"),
    ).toBe("Vendor Admin");
  });

  it("prefers job title headlines over raw display names", () => {
    expect(
      personHeadline(
        { displayName: "void-audit-1780647677647-kybu0d-Vendor Admin" },
        "Field Superintendent",
      ),
    ).toBe("Field Superintendent");
  });

  it("formats vendor POC detail lines with vendor name", () => {
    expect(
      formatSendToDetail({
        group: "vendor_poc_field",
        vendorName: "void-audit-1-abc-Vendor",
        pocRole: "Foreman (Joe Boggs)",
      }),
    ).toBe("Vendor · POC for Foreman (Joe Boggs)");
  });

  it("formats on-ticket lines by org side", () => {
    expect(
      formatSendToDetail({
        group: "on_ticket",
        vendorName: "Baker Hughes",
        orgSide: "vendor",
      }),
    ).toBe("Baker Hughes · on this ticket");
    expect(
      formatSendToDetail({
        group: "on_ticket",
        partnerName: "ExxonMobil",
        orgSide: "partner",
      }),
    ).toBe("ExxonMobil · on this ticket");
  });
});
