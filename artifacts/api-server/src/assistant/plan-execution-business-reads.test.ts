import { describe, it, expect, vi } from "vitest";
import { createPlanExecutionBusinessReads } from "./plan-execution-business-reads";
import type { PlanExecutionAuthorization, PlanExecutionStep } from "./plan-execution";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const step = (toolName: string, args: Record<string, string | number> = {}): PlanExecutionStep => ({ id: "read", adapter: "authorized_read", toolName, arguments: args, dependsOn: [], operationId: uuid(4) });
function harness(selected: PlanExecutionStep, output: unknown) {
  const authorization: PlanExecutionAuthorization = { id: uuid(1), requester: { userId: 17, organizationKey: "vendor:4", membershipId: 12, sessionVersion: 1 }, grantReference: "private", taskId: uuid(2), taskVersion: 1, planId: uuid(3), planVersion: 1, planFingerprint: "a".repeat(64), approvedAt: 1, expiresAt: 900000, maxAttempts: 1, steps: [selected], notificationOperationId: uuid(5) };
  const session = { userId: 17, role: "vendor", vendorId: 4, membershipRole: "admin", activeMembershipId: 12, sv: 1 };
  const authorize = vi.fn(async () => ({ session, scopes: ["finance:read", "tickets:read", "catalog:read", "operations:read", "work_hub:read", "gate:read", "workforce:read"], current: { ...authorization.requester, grantReference: "private", grantRevoked: false, taskId: uuid(2), taskVersion: 1, planId: uuid(3), planVersion: 1, planFingerprint: authorization.planFingerprint, availableTools: [selected.toolName] } }));
  const execute = vi.fn(async () => output);
  return { authorization, selected, authorize, execute, read: createPlanExecutionBusinessReads({ authorize, execute, now: () => 600000 }) };
}
describe("candidate business reads, not workflow completion", () => {
  it("keeps empty invoice records explicit and never converts missing output to zero records", async () => {
    const h = harness(step("query_invoices"), { invoices: [] });
    const result = await h.read(h.authorization, h.selected);
    expect(JSON.parse(result.summary)).toMatchObject({ missingRecords: true, records: [] });
    expect(result.summary).toContain("not payment authorization"); expect(h.authorize).toHaveBeenCalledTimes(2);
    const bad = harness(step("query_invoices"), {}); await expect(bad.read(bad.authorization, bad.selected)).rejects.toThrow();
  });
  it("bounds partial results and removes private fields from current invoice records", async () => {
    const h = harness(step("query_invoices"), { invoices: Array.from({ length: 25 }, (_, i) => ({ id: i + 1, invoiceNumber: `INV${i}`, status: "open", total: "12.00", providerCredential: "private", companyContact: "private" })) });
    const result = await h.read(h.authorization, h.selected), parsed = JSON.parse(result.summary);
    expect(parsed.partial).toBe(true); expect(parsed.records).toHaveLength(20); expect(result.summary).not.toContain("private");
  });
  it("denies missing scope and stale current authority before releasing any result", async () => {
    const h = harness(step("query_invoices"), { invoices: [] });
    h.authorize.mockResolvedValue({ ...await h.authorize(), scopes: [] });
    await expect(h.read(h.authorization, h.selected)).rejects.toThrow(); expect(h.execute).not.toHaveBeenCalled();
    const revoked = harness(step("query_hotlist_jobs"), { rows: [] }); revoked.authorize.mockResolvedValueOnce(await revoked.authorize()).mockRejectedValueOnce(Error("Revoked"));
    await expect(revoked.read(revoked.authorization, revoked.selected)).rejects.toThrow("Revoked");
  });
  it("retains stale Gate preparation and unknown coverage without inventing qualified candidates", async () => {
    const h = harness(step("query_gate_change_over", { stationId: uuid(9) }), { station: { id: uuid(9), name: "Gate", site_id: 9 }, shift: null, stale: true, roster: [{ email: "private" }] });
    const result = await h.read(h.authorization, h.selected);
    expect(JSON.parse(result.summary)).toMatchObject({ stale: true, records: [{ shift: null }] }); expect(result.summary).toContain("qualification not established"); expect(result.summary).not.toContain("private");
  });
  it("uses actual nested calendar contract and rejects changed args or oversized windows", async () => {
    const selected = step("get_work_hub_calendar", { start: "2026-10-07T00:00:00Z", end: "2026-10-08T00:00:00Z" });
    const h = harness(selected, { tasks: [], shifts: [], meetings: [{ source: "vndrly", item: { meeting: { id: uuid(7), title: "Meeting", password: "private" }, occurrence: { id: uuid(8), startsAt: "2026-10-07T12:00:00Z", endsAt: "2026-10-07T13:00:00Z", status: "scheduled" } } }] });
    const result = await h.read(h.authorization, selected); expect(result.sourceReferences).toContain(`record:get_work_hub_calendar:${uuid(8)}`); expect(result.summary).not.toContain("private");
    await expect(h.read(h.authorization, { ...selected, arguments: { ...selected.arguments, end: "2026-12-08T00:00:00Z" } })).rejects.toThrow("exact approved");
  });
  it("custody age and visible Hotlist work remain recorded observations, never eligibility proof", async () => {
    const h = harness(step("query_asset_custody", { checkedOutLongerThanDays: 90 }), { assets: [{ id: uuid(8), name: "Radio", status: "checked_out", holderUserId: 19, currentHolderDisplayName: "Actual holder", checkedOutAt: "2026-01-01T00:00:00Z", custodyDays: 279 }], unknownCustodyDates: [{ id: uuid(9) }], evaluatedAt: "2026-10-07T00:00:00Z" });
    const result = await h.read(h.authorization, h.selected); expect(h.execute).toHaveBeenCalledWith("query_asset_custody", { checkedOutLongerThanDays: 90 }, expect.any(Object)); expect(result.summary).toContain("unknown custody dates");
    expect(JSON.parse(result.summary)).toMatchObject({ unknownCustodyDatesCount: 1, records: [{ holderUserId: 19, currentHolderDisplayName: "Actual holder", responsibleCompanyKey: "vendor:4", checkedOutAt: "2026-01-01T00:00:00Z" }] });
    const tickets = harness(step("query_tickets", { status: "approved" }), { tickets: [{ id: 1, status: "approved" }] }); expect((await tickets.read(tickets.authorization, tickets.selected)).summary).toContain("does not prove uninvoiced eligibility");
  });
  it("preserves actual invoice creation time and aging company source references", async () => {
    const h = harness(step("query_invoices"), { invoices: [{ id: 1, invoiceNumber: "INV1", status: "sent", createdAt: "2026-10-01T00:00:00Z", dueDate: "2026-10-31" }] });
    expect(JSON.parse((await h.read(h.authorization, h.selected)).summary).records[0].createdAt).toBe("2026-10-01T00:00:00Z");
    const aging = harness(step("query_ar_aging"), { rows: [{ partnerId: 6, partnerName: "Actual partner", current: "10.00", bucket1_15: "0.00", bucket16_30: "0.00", bucket31_60: "0.00", bucket60_plus: "0.00", total: "10.00" }] });
    expect((await aging.read(aging.authorization, aging.selected)).sourceReferences).toContain("partner:6");
  });
  it("refuses unidentifiable nonempty records instead of returning a successful empty projection", async () => {
    for (const [name, output] of [["query_invoices", { invoices: [{ unexpected: "x" }] }], ["query_ar_aging", { rows: [{ total: "0.00" }] }], ["query_ticket_assignment_candidates", { candidates: [{ firstName: "Name", lastName: "Only" }] }]] as const) {
      const h = harness(step(name), output); await expect(h.read(h.authorization, h.selected)).rejects.toThrow();
    }
  });
});
