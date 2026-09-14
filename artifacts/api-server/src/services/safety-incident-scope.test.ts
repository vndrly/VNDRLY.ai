import { describe, expect, it } from "vitest";
import { isSafetyIncidentInScope } from "./safety-incident-scope";

describe("isSafetyIncidentInScope", () => {
  const event = { vendorId: 7, partnerId: 4 };

  it("allows the responsible vendor and partner", () => {
    expect(isSafetyIncidentInScope({ type: "vendor", id: 7 }, event)).toBe(
      true,
    );
    expect(isSafetyIncidentInScope({ type: "partner", id: 4 }, event)).toBe(
      true,
    );
  });

  it("rejects another organization", () => {
    expect(isSafetyIncidentInScope({ type: "vendor", id: 9 }, event)).toBe(
      false,
    );
    expect(isSafetyIncidentInScope({ type: "partner", id: 9 }, event)).toBe(
      false,
    );
  });

  it("rejects a missing active organization", () => {
    expect(isSafetyIncidentInScope(null, event)).toBe(false);
  });
});
