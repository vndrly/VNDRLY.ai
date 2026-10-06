import { describe, expect, it } from "vitest";
import { chatGptActionTools } from "./chatgpt-tool-access";
import { validateChatGptActionInput, chatGptActionAuditInput, chatGptActionResult } from "./chatgpt-write-capabilities";

describe("ChatGPT onboarding changes", () => {
  const admin = { userId: 17, role: "vendor", membershipRole: "admin", vendorId: 4 };
  const names = (session = admin, scopes = ["onboarding:write"]) => chatGptActionTools(session, scopes).map(tool => tool.name);
  it("requires separate write consent and resolvable organization administration", () => {
    expect(names(admin, ["onboarding:read"])).toEqual([]);
    expect(names({ ...admin, membershipRole: "member" })).toEqual([]);
    expect(names({ ...admin, vendorId: 0 })).toEqual([]);
    expect(names()).toEqual(expect.arrayContaining(["start_onboarding", "set_onboarding_field", "complete_onboarding_step", "finalize_onboarding"]));
    expect(names(admin, ["gate:write"])).not.toContain("set_onboarding_field");
  });
  it("lets a worker prepare only self-onboarding and never organization finalization", () => {
    const session = { userId: 17, role: "field_employee", vendorPeopleId: 8 };
    const tools = chatGptActionTools(session, ["onboarding:write"]).map(tool => tool.name);
    expect(tools).toContain("set_onboarding_field");
    expect(tools).not.toContain("finalize_onboarding");
    expect(chatGptActionTools({ ...session, vendorPeopleId: null }, ["onboarding:write"])).toEqual([]);
  });
  it("keeps ticket and notification grants separate and preserves registry roles", () => {
    const worker = { userId: 17, role: "field_employee", vendorPeopleId: 8, vendorId: 4 };
    const ticketTools = chatGptActionTools(worker, ["tickets:write"]).map(tool => tool.name);
    expect(ticketTools).toContain("set_ticket_lifecycle");
    expect(ticketTools).toContain("post_ticket_comment");
    expect(ticketTools).not.toContain("schedule_ticket_crew");
    expect(ticketTools).not.toContain("mark_notifications_read");
    expect(chatGptActionTools(worker, ["operations:write"]).map(tool => tool.name)).toEqual(["mark_notifications_read"]);
    expect(chatGptActionTools(worker, ["tickets:read", "operations:read"])).toEqual([]);
  });
  it("cannot manufacture legal acceptance, credentials, or prototype paths", () => {
    expect(() => validateChatGptActionInput("complete_onboarding_step", { step: "set-password", nextStep: "done" })).toThrow();
    for (const path of ["platformEula.accepted", "legalConsent.accepted", "legalConsent.smsOptIn", "info.password", "info.accessToken", "__proto__.admin", "info.constructor.prototype", "info..firstName"]) {
      expect(() => validateChatGptActionInput("set_onboarding_field", { path, value: true }), path).toThrow();
    }
    expect(() => validateChatGptActionInput("set_onboarding_field", { path: "firstSite.name", value: "Synthetic site" })).not.toThrow();
    expect(() => validateChatGptActionInput("set_onboarding_field", { path: "firstSite", value: { name: "Synthetic" } })).toThrow();
  });
  it("does not copy private field values into audit or completed results", () => {
    const input = { path: "taxIds.federalTaxId", value: "synthetic-private-value" };
    expect(chatGptActionAuditInput("set_onboarding_field", input)).toEqual({ path: input.path, value: "[redacted]" });
    expect(chatGptActionResult("set_onboarding_field", { ok: true, ...input })).toEqual({ ok: true, path: input.path });
    expect(input.value).toBe("synthetic-private-value");
    expect(chatGptActionResult("finalize_onboarding", { ok: true, response: JSON.stringify({ currentStep: "done", completedAt: "2026-10-06", payload: { taxId: "synthetic-private-value" } }) }))
      .toEqual({ ok: true, progress: { currentStep: "done", completedAt: "2026-10-06" } });
  });
});
