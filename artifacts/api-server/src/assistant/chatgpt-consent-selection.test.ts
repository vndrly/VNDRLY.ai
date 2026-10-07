import { describe, expect, it } from "vitest";
import { selectConsentedScopes } from "./chatgpt-consent-selection";

describe("scope selection", () => {
  it("retains signed-request order while allowing a narrower grant", () => {
    expect(selectConsentedScopes(["gate:read", "tickets:read", "finance:write"], ["tickets:read", "gate:read"]))
      .toEqual(["gate:read", "tickets:read"]);
    expect(selectConsentedScopes(["gate:read", "tickets:read"], "tickets:read")).toEqual(["tickets:read"]);
  });
  it.each([undefined, [], {}, ["finance:write"], ["gate:read", "gate:read"], [17]])("rejects missing, forged or ambiguous selection %j", input => {
    expect(() => selectConsentedScopes(["gate:read", "tickets:read"], input)).toThrow("invalid_scope");
  });
});

