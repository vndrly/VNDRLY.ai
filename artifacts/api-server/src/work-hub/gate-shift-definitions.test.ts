import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "../lib/session";
vi.mock("@workspace/db", async importOriginal => ({ ...await importOriginal<typeof import("@workspace/db")>(), db: {}, pool: {} }));
vi.mock("../assistant/chatgpt-grant-store", () => ({ validateAssistantSession: async (session: unknown) => session }));
import { gateDefinitionManager, materializeGateDefinition, retireGateDefinition } from "./gate-shift-definitions";
const actor = { userId: 1, role: "vendor", vendorId: 7, membershipRole: "admin", vendorRole: "office" } as SessionPayload;
const definition = { id: "11111111-1111-4111-a111-111111111111", version: 1, stationId: "22222222-2222-4222-a222-222222222222", stationIds: [], vendorId: 7, siteId: 3, siteName: "North", gateName: "Main", createdById: 1, startsAtLocal: "06:00", endsAtLocal: "18:00", weekdays: [0,1,2,3,4,5,6], timezone: "America/Chicago", requiredCount: 1, notes: "Radio", userIds: [], crewIds: [] };
afterEach(() => vi.useRealTimers());
describe("recurring gate definition schedules", () => {
  it("requires a current manager in the same vendor and rejects gatekeepers and managed workers", async () => {
    await expect(gateDefinitionManager(actor, 7)).resolves.toMatchObject({ vendorId: 7 });
    await expect(gateDefinitionManager(actor, 8)).rejects.toThrow();
    await expect(gateDefinitionManager({ ...actor, membershipRole: "member", vendorRole: "gatekeeper" }, 7)).rejects.toThrow();
    await expect(gateDefinitionManager({ ...actor, managedSubcontractor: {} as any }, 7)).rejects.toThrow();
  });
  it("fills empty watches once and never changes an existing watch or its assigned people", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-29T22:00:00Z"));
    const starts = new Set<string>();
    const query = vi.fn(async (text: string, values: any[] = []) => {
      if (text.startsWith("SELECT id FROM workforce_staffing_requirements")) return { rows: [{ id: "requirement" }] };
      if (text.startsWith("SELECT id FROM work_hub_shifts")) return { rows: starts.has(String(values[3])) ? [{ id: "existing-watch-with-people" }] : [] };
      if (text.startsWith("INSERT INTO work_hub_shifts")) starts.add(String(values[3]));
      return { rows: [] };
    });
    const client = { query } as any;
    expect(await materializeGateDefinition(client, definition)).toBeGreaterThan(0);
    const first = starts.size;
    expect(await materializeGateDefinition(client, definition)).toBe(0);
    expect(starts.size).toBe(first);
    expect(query.mock.calls.some(([text]) => /UPDATE work_hub_shifts|DELETE|INSERT INTO work_hub_shift_assignments/.test(text))).toBe(false);
  });
  it("does not extend a definition whose saved version was replaced or retired", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    expect(await materializeGateDefinition({ query } as any, definition)).toBe(0);
    expect(query).toHaveBeenCalledTimes(2);
  });
  it("retires only a current definition and preserves watches and assignments", async () => {
    const query = vi.fn(async (text: string, _values?: unknown[]) => ({ rows: text.startsWith("SELECT r.*") ? [{ gate_definition: { id: definition.id, version: 1, stationId: definition.stationId }, site_id: 3, site_name: "North", gate_name: "Main", weekday: 0 }] : [] }));
    expect(await retireGateDefinition({ query } as any, actor, 7, definition.id, 1, "operation")).toEqual({ id: definition.id, retired: true });
    const updates = query.mock.calls.filter(([text]) => text.startsWith("UPDATE"));
    expect(updates).toHaveLength(1);
    expect(updates[0][1]).toEqual([7, definition.id]);
    expect(query.mock.calls.some(([text]) => /DELETE|UPDATE work_hub_shifts|UPDATE work_hub_shift_assignments/.test(text))).toBe(false);
    query.mockClear();
    await expect(retireGateDefinition({ query } as any, actor, 7, definition.id, 2, "operation")).rejects.toMatchObject({ status: 409 });
    expect(query.mock.calls.some(([text]) => text.startsWith("UPDATE"))).toBe(false);
  });
});
