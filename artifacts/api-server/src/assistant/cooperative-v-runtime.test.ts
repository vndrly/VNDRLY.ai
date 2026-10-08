import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), policy: vi.fn(), request: vi.fn(), connect: vi.fn() }));
vi.mock("@workspace/db", () => ({ pool: { query: mocks.query, connect: mocks.connect } }));
vi.mock("../services/native-operations", () => ({ getNativeCompanyPolicy: mocks.policy }));
vi.mock("./natural-voice-write-tools", () => ({ callNaturalVoiceDomainApi: mocks.request }));
import { bindVConversationCompany, listVConnections, readSelectedVCalendar, readSelectedVConnection, resolveVTurnPolicy } from "./cooperative-v-runtime";

describe("V runtime authority and minimized external reads", () => {
  const actor = { userId: 7, vendorId: 10, membershipRole: "admin", role: "vendor" };
  const id = "35c34a3c-ef90-459d-9a4b-e980ec0c8a12";
  const connection = { id, ownerOrgType: "vendor", ownerOrgId: 10, createdById: 7, provider: "microsoft-365", capabilities: ["calendar.read"], status: "connected", revokedAt: null };
  const selection = { connectionId: id, scope: "company" as const, personalPermission: false, savePersonalContentToCompany: false };
  beforeEach(() => { vi.clearAllMocks(); mocks.policy.mockResolvedValue({ enabled: true, approvedAiProviders: ["anthropic", "openai"], usageAlertTokens: 1000000, usageAlertUsd: 25 }); });
  it("checks current membership/policy and exact connection for every read", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ role: "admin" }] }).mockResolvedValueOnce({ rows: [connection] }).mockResolvedValueOnce({ rows: [{ id: "event", title: "Selected event", startsAt: new Date(), endsAt: new Date(), location: null, syncedAt: new Date() }] });
    const result = await readSelectedVCalendar(actor, selection, { start: "2026-10-07T00:00:00Z", end: "2026-10-08T00:00:00Z" });
    expect(mocks.policy).toHaveBeenCalledWith(actor);
    expect(mocks.query.mock.calls[1][1]).toEqual([id]);
    expect(mocks.query.mock.calls[2][0]).toContain("c.connection_id=$1");
    expect(mocks.query.mock.calls[2][0]).toContain("c.selected='true'");
    expect(mocks.query.mock.calls[2][0]).toContain("LIMIT 25");
    expect(result).toMatchObject({ liveProviderRead: false, source: "authorized_synced_calendar", events: [{ title: "Selected event" }] });
    expect(result).not.toHaveProperty("encryptedCredentials");
  });
  it("does not reinterpret missing or revoked grants as provider fallback", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ role: "admin" }] }).mockResolvedValueOnce({ rows: [] });
    await expect(readSelectedVConnection(actor, selection)).rejects.toThrow("missing");
    mocks.query.mockResolvedValueOnce({ rows: [{ role: "admin" }] }).mockResolvedValueOnce({ rows: [{ ...connection, revokedAt: new Date() }] });
    await expect(readSelectedVConnection(actor, selection)).rejects.toThrow("unavailable");
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("a live demotion prevents stale signed-admin membership from reading company content", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ role: "member" }] }).mockResolvedValueOnce({ rows: [connection] });
    await expect(readSelectedVCalendar(actor, selection, { start: "2026-10-07T00:00:00Z", end: "2026-10-08T00:00:00Z" })).rejects.toThrow();
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.query.mock.calls.some(call => String(call[0]).includes("FROM work_hub_external_events"))).toBe(false);
  });
  it("rejects excessive windows before fetching external content", async () => {
    await expect(readSelectedVCalendar(actor, selection, { start: "2026-10-07T00:00:00Z", end: "2027-10-08T00:00:00Z" })).rejects.toThrow();
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("company opt out stops cooperation and external reads without promoting OpenAI", async () => {
    mocks.policy.mockResolvedValue({ enabled: false, approvedAiProviders: ["anthropic", "openai"] });
    expect(await resolveVTurnPolicy(actor)).toMatchObject({ enabled: false, approvedAiProviders: ["anthropic"] });
    expect(await listVConnections(actor)).toEqual([]);
    await expect(readSelectedVConnection(actor, selection)).rejects.toThrow("disabled");
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("locks conversation ownership before binding company context and rejects changed organization", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 9 }] }).mockResolvedValueOnce({ rows: [{ parsedIntent: { organizationKey: "different-company" } }] });
    const release = vi.fn();
    mocks.connect.mockResolvedValue({ query, release });
    await expect(bindVConversationCompany(actor, 9)).rejects.toThrow("company context");
    expect(query.mock.calls[1][0]).toContain("FOR UPDATE");
    expect(query.mock.calls[1][1]).toEqual([9, 7]);
    expect(query.mock.calls.some(call => call[0] === "ROLLBACK")).toBe(true);
    expect(release).toHaveBeenCalled();
  });
});
