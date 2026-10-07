import { describe, expect, it } from "vitest";
import type { FleetActionInput } from "@workspace/api-zod";
import { createFleetOfflineStore, fleetOfflineByteLength } from "./fleet-offline";
const scope = { userId: 1069, companyId: 609, membershipId: 1 };
function fixture() {
  const records = new Map<string, string>();
  return createFleetOfflineStore({ getItem: async key => records.get(key) ?? null, setItem: async (key, value) => { records.set(key, value); }, removeItem: async key => { records.delete(key); } });
}
describe("Fleet scoped offline actions", () => {
  it("preserves immutable operation/revision, separates accounts and forbids a second pending action per run", async () => {
    const queue = fixture();
    const input = { operationId: "10000000-0000-4000-8000-000000000001", expectedVersion: 7, action: "inspect", notes: "Light fault", inspectionOutcome: "defect_reported" } as FleetActionInput;
    await queue.enqueue(scope, { runId: "20000000-0000-4000-8000-000000000001", input, capturedAt: "2026-10-07T12:00:00Z", state: "unsynced" });
    expect((await queue.read(scope)).actions[0].input).toEqual(input);
    expect((await queue.read({ ...scope, companyId: 610 })).actions).toEqual([]);
    await expect(queue.enqueue(scope, { runId: "20000000-0000-4000-8000-000000000001", input: { ...input, operationId: "10000000-0000-4000-8000-000000000002" }, capturedAt: "2026-10-07T12:01:00Z", state: "unsynced" })).rejects.toThrow("Synchronize");
    await queue.resolve(scope, "10000000-0000-4000-8000-000000000001", "revoked", "Grant removed");
    expect((await queue.read(scope)).actions[0].state).toBe("revoked");
    await queue.clear(scope);
    expect((await queue.read(scope)).actions).toEqual([]);
  });
  it("measures UTF8 bytes so multibyte notes cannot bypass the secure storage bound", () => {
    expect(fleetOfflineByteLength("abc")).toBe(3);
    expect(fleetOfflineByteLength("é中🚚")).toBe(9);
  });
});
