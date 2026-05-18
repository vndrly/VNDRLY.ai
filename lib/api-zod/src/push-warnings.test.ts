import { describe, expect, it } from "vitest";
import {
  formatPushWarningLine,
  formatPushWarningsForCopy,
  type PushWarning,
} from "./push-warnings";

// Lightweight unit coverage for the shared push-warning formatter that
// the api-server (digest emails) and the vndrly Reports "Copy all" button
// both consume. If the wording or punctuation drifts, admins would see
// different text in their inbox than in the app.
describe("formatPushWarningLine", () => {
  it("capitalizes the kind label and joins identifier and message", () => {
    expect(
      formatPushWarningLine({
        kind: "invoice",
        identifier: "INV-1001",
        message: "Item missing on QBO; mapped to fallback.",
      }),
    ).toBe("Invoice INV-1001: Item missing on QBO; mapped to fallback.");
  });

  it("supports all three push warning kinds", () => {
    expect(
      formatPushWarningLine({
        kind: "customer",
        identifier: "Acme Drilling",
        message: "Email already in use.",
      }),
    ).toBe("Customer Acme Drilling: Email already in use.");
    expect(
      formatPushWarningLine({
        kind: "vendor",
        identifier: "Roughneck Co",
        message: "TIN format invalid.",
      }),
    ).toBe("Vendor Roughneck Co: TIN format invalid.");
  });
});

describe("formatPushWarningsForCopy", () => {
  it("returns empty string for an empty list", () => {
    expect(formatPushWarningsForCopy([])).toBe("");
  });

  it("joins multiple warnings with newlines in input order", () => {
    const warnings: PushWarning[] = [
      { kind: "customer", identifier: "Acme", message: "missing email" },
      { kind: "invoice", identifier: "INV-2", message: "tax misposted" },
    ];
    expect(formatPushWarningsForCopy(warnings)).toBe(
      "Customer Acme: missing email\nInvoice INV-2: tax misposted",
    );
  });
});
