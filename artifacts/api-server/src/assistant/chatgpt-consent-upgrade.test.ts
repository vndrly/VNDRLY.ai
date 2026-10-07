import { describe, expect, it } from "vitest";
import { financeConsentUpgradeTools, requiresFinanceConsent, financeConsentChallenge } from "./chatgpt-consent-upgrade";

describe("finance consent upgrade discovery", () => {
  const partner = { userId: 17, role: "partner", partnerId: 8, membershipRole: "admin" };
  it("offers only eligible missing finance tools without changing scopes", () => {
    const scopes = ["gate:read"];
    expect(financeConsentUpgradeTools(partner, scopes).map(tool => tool.name)).toEqual(["record_ticket_payment", "reverse_ticket_payment_record"]);
    expect(scopes).toEqual(["gate:read"]);
    expect(financeConsentUpgradeTools(partner, ["finance:write"])).toEqual([]);
    expect(financeConsentUpgradeTools({ userId: 17, role: "field_employee", vendorId: 8 }, scopes)).toEqual([]);
  });
  it("requires consent for direct and generic finance requests only", () => {
    expect(requiresFinanceConsent(partner, [], "record_ticket_payment", {})).toBe(true);
    expect(requiresFinanceConsent(partner, [], "v_prepare_action", { toolName: "reverse_ticket_payment_record" })).toBe(true);
    expect(requiresFinanceConsent(partner, [], "manage_ticket_record", {})).toBe(false);
  });
  it("preserves current scopes in the challenge without account or entity payload", () => {
    const result = financeConsentChallenge("https://vndrly.ai/api/assistant-connection", ["gate:read", "gate:read"]);
    expect(result.isError).toBe(true);
    expect(result._meta["mcp/www_authenticate"][0]).toContain('scope="gate:read finance:write"');
    expect(result._meta["mcp/www_authenticate"][0]).toContain('error="insufficient_scope"');
  });
});

