import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rows: [] as unknown[][], selects: [] as Record<string, unknown>[], capability: vi.fn() }));
vi.mock("@workspace/db", async original => {
  const db = await original<typeof import("@workspace/db")>();
  return { ...db, db: { ...db.db, select: (fields: Record<string, unknown>) => {
    state.selects.push(fields); const rows = state.rows.shift() ?? [];
    const query: any = { from: () => query, where: () => query, innerJoin: () => query, limit: async () => rows, then: (resolve: (x: unknown) => unknown) => Promise.resolve(rows).then(resolve) };
    return query;
  } } };
});
vi.mock("../services/ticket-labor-finalization", () => ({ createTicketLaborFinalizationService: () => ({ canFinalize: state.capability }) }));
import { runDataTool } from "./data-tools";
const session = { userId: 9, role: "vendor", vendorId: 4, sv: 1, activeMembershipId: 5 };
const timestamp = new Date("2026-10-07T10:00:00.000Z");
beforeEach(() => { state.selects = []; state.rows = []; state.capability.mockReset(); });
it("the registered ticket detail read retains canonical review timestamp and fresh capability without fabricating role authority", async () => {
  state.rows = [[{ id: 7 }], [{ id: 7, status: "pending_review", lifecycleState: "off_site", updatedAt: timestamp, createdAt: timestamp, closedAt: null, vendorId: 4 }], [{ n: 1 }], [{ n: 0 }], [{ n: 2 }]];
  state.capability.mockResolvedValueOnce(true);
  const result = JSON.parse(await runDataTool("query_ticket_detail", { ticketId: 7 }, session));
  expect(result).toMatchObject({ ticketId: 7, updatedAt: timestamp.toISOString(), viewerCanFinalizeLabor: true, status: "pending_review", closedAt: null });
  expect(state.selects[1]).toHaveProperty("updatedAt");
  expect(state.capability).toHaveBeenCalledWith(session, 7);
});
it("a readable ticket still exposes false finalization authority when canonical current permission is denied", async () => {
  state.rows = [[{ id: 7 }], [{ id: 7, updatedAt: timestamp }], [], [], []]; state.capability.mockResolvedValueOnce(false);
  expect(JSON.parse(await runDataTool("query_ticket_detail", { ticketId: 7 }, session))).toMatchObject({ updatedAt: timestamp.toISOString(), viewerCanFinalizeLabor: false });
});
it("existing ticket visibility denial prevents capability lookup and record disclosure", async () => {
  state.rows = [[]];
  expect(JSON.parse(await runDataTool("query_ticket_detail", { ticketId: 7 }, session))).toHaveProperty("error");
  expect(state.capability).not.toHaveBeenCalled(); expect(state.selects).toHaveLength(1);
});
