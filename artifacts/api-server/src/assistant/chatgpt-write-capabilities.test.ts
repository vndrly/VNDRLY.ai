import { describe, expect, it } from "vitest";
import { chatGptActionTools } from "./chatgpt-tool-access";
import { validateChatGptActionInput, sanitizeChatGptActionInput, chatGptActionAuditInput, chatGptActionResult } from "./chatgpt-write-capabilities";

describe("ChatGPT onboarding changes", () => {
  const admin = { userId: 17, role: "vendor", membershipRole: "admin", vendorId: 4 };
  const names = (session = admin, scopes = ["onboarding:write"]) => chatGptActionTools(session, scopes).map(tool => tool.name);
  it.each([
    ["admin", ["approve", "accept", "reactivate"]],
    ["partner", ["approve", "reinvite"]],
    ["vendor", ["accept", "deny"]],
    ["field_employee", ["create", "update", "submit"]],
  ])("advertises only the canonical ticket action family for %s", (role, expected) => {
    const actor = { userId: 17, role: String(role), vendorId: 4, partnerId: 5, vendorPeopleId: 8 };
    expect(chatGptActionTools(actor, ["tickets:read"])).toEqual([]);
    const tool = chatGptActionTools(actor, ["tickets:write"]).find(item => item.name === "manage_ticket_record")!;
    const schema = tool.inputSchema as { properties: { action: { enum: string[] } } };
    expect(schema.properties.action.enum).toEqual(expect.arrayContaining(expected as string[]));
    if (role !== "admin") expect(schema.properties.action.enum).not.toContain("reactivate");
    if (!["admin", "partner"].includes(String(role))) expect(schema.properties.action.enum).not.toContain("approve");
    if (!["admin", "vendor"].includes(String(role))) expect(schema.properties.action.enum).not.toContain("accept");
  });
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
  it("requires asset and invitation writes separately and restricts invitation administration", () => {
    expect(names(admin, ["operations:read", "invitations:read"])).toEqual([]);
    expect(names(admin, ["assets:write"])).toEqual(["confirm_asset_custody_action"]);
    expect(names(admin, ["invitations:write"])).toEqual(["confirm_account_invitations_action"]);
    expect(names({ ...admin, membershipRole: "member" }, ["invitations:write"])).toEqual([]);
    expect(chatGptActionTools({ userId: 17, role: "partner", partnerId: 4, membershipRole: "admin" }, ["invitations:write"])).toEqual([]);
  });
  it("requires each remaining action family and prevents assistant-supplied trip telemetry", () => {
    for (const [scope, name] of [["workforce:write", "confirm_workforce_coverage_action"], ["trips:write", "confirm_field_trips_action"], ["safety:write", "confirm_incident_response_action"], ["subscriptions:write", "confirm_worker_subscriptions_action"]]) {
      expect(names(admin, [scope])).toEqual([name]);
      expect(names(admin, [scope.replace(":write", ":read")])).toEqual([]);
    }
    expect(names({ ...admin, membershipRole: "member" }, ["subscriptions:write"])).toEqual([]);
    const raw = { action: "location", payload: { expectedVersion: 1, latitude: 30, longitude: -100, accuracyMeters: 1, recordedAt: "fake", speedMps: 99, operationId: "fake", confirmed: true } };
    expect(sanitizeChatGptActionInput("confirm_field_trips_action", raw)).toEqual({ action: "location", payload: { expectedVersion: 1 } });
    expect(raw.payload.latitude).toBe(30);
    expect(() => validateChatGptActionInput("confirm_field_trips_action", { action: "forged" })).toThrow();
    expect(chatGptActionResult("confirm_incident_response_action", { id: 1, eventId: 2, originalReport: "private", safetyChainSnapshot: [17], responseStatus: "closed" })).toEqual({ id: 1, eventId: 2, responseStatus: "closed" });
    expect(chatGptActionAuditInput("confirm_incident_response_action", { action: "evidence", payload: { value: "private" } })).toMatchObject({ payload: "[redacted]" });
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
