import { describe, expect, it } from "vitest";
import { resolveExecutableWorkHubToolRequest } from "./work-hub-tool-runtime";
import { validateChatGptActionInput } from "./chatgpt-write-capabilities";
const base = { operationId: "00000000-0000-4000-8000-000000000001", recordId: "11111111-1111-4111-8111-111111111111", owner: { type: "vendor", id: 42 }, context: { kind: "organization", id: 42 }, payload: {} };
describe("record-only Work Hub finance actions", () => {
  it("requires trusted confirmation and maps exact issue/share/revoke actions", () => {
    for (const [action, endpoint, payload] of [["issue", "issue", {}], ["share", "share", { audience: "anyone_with_link", expiresInDays: 30 }], ["revoke_share", "revoke-share", {}]] as const) {
      const input = { ...base, action, payload };
      expect(resolveExecutableWorkHubToolRequest("manage_work_hub_finance", input, false)).toMatchObject({ requiresConfirmation: true });
      expect(resolveExecutableWorkHubToolRequest("manage_work_hub_finance", input, true)).toMatchObject({ method: "POST", path: `/work-hub/finance/${endpoint}`, body: { operationId: base.operationId, payload: { id: base.recordId } } });
    }
  });
  it("records an already-made outside payment without routing bank credentials or refund actions", () => {
    const input = { ...base, action: "record_outside_payment", payload: { amountCents: 2500, method: "check", reference: "Actual check 123" } };
    expect(resolveExecutableWorkHubToolRequest("manage_work_hub_finance", input, true)).toMatchObject({ path: "/work-hub/finance/payment", body: { payload: { id: base.recordId, amountCents: 2500, method: "check", reference: "Actual check 123" } } });
    for (const payload of [{ ...input.payload, bankAccount: "secret" }, { ...input.payload, amountCents: 1.5 }, { ...input.payload, reference: "" }]) expect(() => validateChatGptActionInput("manage_work_hub_finance", { ...input, payload })).toThrow();
    expect(resolveExecutableWorkHubToolRequest("manage_work_hub_finance", { ...input, action: "refund" }, true)).toHaveProperty("error");
  });
  it("rejects missing exact invoice IDs and undisclosed public-link audience before preparation", () => {
    expect(() => validateChatGptActionInput("manage_work_hub_finance", { ...base, action: "issue", recordId: "" })).toThrow();
    for (const payload of [{}, { audience: "company_only", expiresInDays: 30 }, { audience: "anyone_with_link", expiresInDays: 1 }]) expect(() => validateChatGptActionInput("manage_work_hub_finance", { ...base, action: "share", payload })).toThrow();
  });
});
