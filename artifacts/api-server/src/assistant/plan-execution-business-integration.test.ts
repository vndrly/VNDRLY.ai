import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ runTool: vi.fn() }));
vi.mock("../routes/assistant", () => ({ runTool: mocks.runTool }));
import { planExecutionAuthorizationSchema, planExecutionResultSchema } from "./plan-execution";
import { createPlanExecutionAdapters } from "./plan-execution-adapters";
import { createPlanExecutionCanonicalApi } from "./plan-execution-canonical";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const value = { id: uuid(1), requester: { userId: 17, organizationKey: "vendor:4", membershipId: 12, sessionVersion: 1 }, grantReference: "private", taskId: uuid(2), taskVersion: 1, planId: uuid(3), planVersion: 1, planFingerprint: "a".repeat(64), approvedAt: 1, expiresAt: 900000, maxAttempts: 1, steps: [{ id: "read", adapter: "authorized_read", toolName: "query_invoices", arguments: { sinceDays: 90, limit: 20 }, dependsOn: [], operationId: uuid(4) }], notificationOperationId: uuid(5) };
describe("registered business read dispatch", () => {
  it("accepts bounded approved core read and reaches the canonical scoped tool through executor adapters", async () => {
    const authorization = planExecutionAuthorizationSchema.parse(value);
    const authorize = vi.fn(async () => ({ session: { userId: 17, role: "vendor", vendorId: 4, membershipRole: "admin", activeMembershipId: 12, sv: 1 }, scopes: ["finance:read"], current: { ...authorization.requester, grantReference: "private", grantRevoked: false, taskId: uuid(2), taskVersion: 1, planId: uuid(3), planVersion: 1, planFingerprint: authorization.planFingerprint, availableTools: ["query_invoices"] } }));
    mocks.runTool.mockResolvedValue(JSON.stringify({ invoices: [{ id: 8, invoiceNumber: "INV8", status: "sent", createdAt: "2026-10-01T00:00:00Z" }] }));
    const adapter = createPlanExecutionAdapters(createPlanExecutionCanonicalApi({ authorize }));
    const result = await adapter.authorized_read.execute({ authorization, results: [] }, authorization.steps[0]);
    expect(planExecutionResultSchema.parse(result).sourceReferences).toContain("record:query_invoices:8");
    expect(mocks.runTool).toHaveBeenCalledWith("query_invoices", { sinceDays: 90, limit: 20 }, expect.objectContaining({ userId: 17, vendorId: 4 }), "", false, false);
    expect(authorize).toHaveBeenCalledTimes(2);
  });
  it("rejects unbounded or forged read arguments at core approval validation", () => {
    expect(() => planExecutionAuthorizationSchema.parse({ ...value, steps: [{ ...value.steps[0], arguments: { vendorId: 999 } }] })).toThrow("bounded business read");
    expect(() => planExecutionAuthorizationSchema.parse({ ...value, steps: [{ ...value.steps[0], arguments: { limit: 1000 } }] })).toThrow("bounded business read");
  });
  it("routes explicit 90-day custody through itemized holder read while preserving legacy shorter-age requests", async () => {
    const authorization = planExecutionAuthorizationSchema.parse({ ...value, steps: [{ ...value.steps[0], toolName: "query_asset_custody", arguments: { checkedOutLongerThanDays: 90 } }] });
    const authorize = async () => ({ session: { userId: 17, role: "vendor", vendorId: 4, membershipRole: "admin", activeMembershipId: 12, sv: 1 }, scopes: ["operations:read"], current: { ...authorization.requester, grantReference: "private", grantRevoked: false, taskId: uuid(2), taskVersion: 1, planId: uuid(3), planVersion: 1, planFingerprint: authorization.planFingerprint, availableTools: ["query_asset_custody"] } });
    mocks.runTool.mockResolvedValue(JSON.stringify({ assets: [{ id: uuid(8), name: "Radio", status: "checked_out", holderUserId: 17, currentHolderDisplayName: "Actual holder", checkedOutAt: "2026-01-01T00:00:00Z", custodyDays: 279 }], unknownCustodyDates: [], evaluatedAt: "2026-10-07T00:00:00Z" }));
    const request = vi.fn(async () => ({ assets: [{ id: uuid(9), name: "Legacy radio", status: "checked_out", condition: null }] }));
    const api = createPlanExecutionCanonicalApi({ authorize, request });
    expect(JSON.parse((await api.read(authorization, authorization.steps[0])).summary).records[0]).toMatchObject({ holderUserId: 17, checkedOutAt: "2026-01-01T00:00:00Z" }); expect(request).not.toHaveBeenCalled();
    const legacy = planExecutionAuthorizationSchema.parse({ ...authorization, steps: [{ ...authorization.steps[0], arguments: { checkedOutLongerThanDays: 30 } }] });
    await api.read(legacy, legacy.steps[0]); expect(request).toHaveBeenCalledWith("/implementation-a/assets?checkedOutLongerThanDays=30", "GET", {}, expect.objectContaining({ userId: 17 }));
  });
});
