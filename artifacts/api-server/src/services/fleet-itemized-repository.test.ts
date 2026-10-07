import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FleetRunSchema } from "@workspace/api-zod";
import type { PoolClient } from "pg";
import { emptyFleetState, type FleetRepository } from "./fleet-repository";
import {
  createItemizedFleetRepository,
  readRunPage,
  type FleetItemizedAuthority,
} from "./fleet-itemized-repository";

const run = () =>
  FleetRunSchema.parse({
    id: randomUUID(),
    fleetId: randomUUID(),
    companyId: 7,
    title: "Synthetic history",
    driverUserId: 2,
    vehicleAssetId: randomUUID(),
    trailerAssetId: null,
    siteIds: [9],
    status: "completed",
    phase: null,
    version: 2,
    stops: [{ id: randomUUID(), siteId: 9, kind: "pickup", sequence: 0 }],
    loads: [],
    inspections: [],
    currentStopId: null,
    visitedStopIds: [],
    events: [],
    linkedTicketId: null,
    allowedActions: [],
  });
function fixture(count = 0) {
  let state = {
    ...emptyFleetState(),
    runs: Array.from({ length: count }, run),
  };
  const audit: {
    id: number;
    vendorId: number;
    tool_output: ReturnType<typeof run>;
  }[] = [];
  const client = {
    query: async (sql: string, args: unknown[]) => {
      if (sql.startsWith("INSERT")) {
        audit.push({
          id: audit.length + 1,
          vendorId: Number(args[1]),
          tool_output: JSON.parse(String(args[3])),
        });
        return { rows: [] };
      }
      let rows = audit.filter((a) => a.vendorId === Number(args[1]));
      if (sql.includes("tool_output->>'version'"))
        return {
          rows: rows.filter(
            (a) =>
              a.tool_output.id === args[0] &&
              String(a.tool_output.version) === args[2],
          ),
        };
      if (sql.includes("ORDER BY id DESC LIMIT 1"))
        return {
          rows: rows.filter((a) => a.tool_output.id === args[0]).slice(-1),
        };
      if (sql.includes("COALESCE(MAX"))
        return {
          rows: [
            {
              id: Math.max(
                0,
                ...audit
                  .filter((a) => a.vendorId === Number(args[0]))
                  .map((a) => a.id),
              ),
            },
          ],
        };
      if (sql.includes("target_id=ANY")) {
        const latest = new Map<string, (typeof audit)[number]>();
        for (const a of audit.filter(
          (a) =>
            a.vendorId === Number(args[0]) &&
            (args[1] as string[]).includes(a.tool_output.id),
        ))
          latest.set(a.tool_output.id, a);
        return { rows: [...latest.values()] };
      }
      if (sql.includes("DISTINCT ON")) {
        const latest = new Map<string, (typeof audit)[number]>();
        for (const a of audit.filter(
          (a) => a.vendorId === Number(args[0]) && a.id <= Number(args[1]),
        ))
          latest.set(a.tool_output.id, a);
        return {
          rows: [...latest.values()]
            .filter((a) => a.id < Number(args[2]))
            .sort((a, b) => b.id - a.id)
            .slice(0, Number(args[3])),
        };
      }
      return { rows: [] };
    },
  } as unknown as PoolClient;
  const base: FleetRepository = {
    async transaction(company, user, operation) {
      const copy = structuredClone(state);
      const result = await operation(copy, client);
      state = copy;
      return result;
    },
  };
  return {
    repository: createItemizedFleetRepository(
      base,
      () => new Error("capacity"),
    ),
    state: () => state,
    audit,
    client,
  };
}
describe("itemized Fleet retained history", () => {
  it("keeps cursor snapshots separate from latest assignment authority", async () => {
    const f = fixture(3);
    await f.repository.transaction(7, 1, async () => null, {});
    const page = await readRunPage(f.client, 7, undefined, 1);
    const target = f.audit[1].tool_output;
    f.audit.push({
      id: 4,
      vendorId: 7,
      tool_output: { ...structuredClone(target), driverUserId: 99, version: 3 },
    });
    const authority: FleetItemizedAuthority = {
      runPage: { cursor: page.nextCursor!, limit: 1 },
    };
    await f.repository.transaction(7, 1, async () => null, authority);
    expect(authority.pageRuns?.[0].driverUserId).toBe(2);
    expect(authority.currentRunsById?.get(target.id)?.driverUserId).toBe(99);
    expect(f.state().runs).toEqual([]);
  });
  it("archives hundreds of terminal records before freeing aggregate capacity and replays migration without duplicates", async () => {
    const f = fixture(800);
    const ids = f.state().runs.map((r) => r.id);
    await f.repository.transaction(7, 1, async () => "read", {});
    expect(f.state().runs).toEqual([]);
    expect(f.audit).toHaveLength(800);
    await f.repository.transaction(7, 1, async () => "read", {});
    expect(f.audit).toHaveLength(800);
    const authority: FleetItemizedAuthority = { runId: ids[0] };
    const loaded = await f.repository.transaction(
      7,
      1,
      async (state) => state.runs[0],
      authority,
    );
    expect(loaded.id).toBe(ids[0]);
    expect(f.state().runs).toEqual([]);
  });
  it("persists an updated terminal snapshot atomically before removing its open copy", async () => {
    const f = fixture(1);
    f.state().runs[0].status = "in_progress";
    await f.repository.transaction(
      7,
      1,
      async (state) => {
        state.runs[0].status = "completed";
        state.runs[0].version++;
        return state.runs[0];
      },
      {},
    );
    expect(f.audit.map((a) => a.tool_output.status)).toEqual([
      "in_progress",
      "completed",
    ]);
    expect(f.state().runs).toEqual([]);
  });
  it("provides stable bounded historical pages without silently discarding records", async () => {
    const f = fixture(120);
    await f.repository.transaction(7, 1, async () => null, {});
    const first = await readRunPage(f.client, 7, undefined, 50);
    expect(first.runs).toHaveLength(50);
    expect(first.nextCursor).toBeTruthy();
    const second = await readRunPage(f.client, 7, first.nextCursor!, 50);
    expect(second.runs).toHaveLength(50);
    const last = await readRunPage(f.client, 7, second.nextCursor!, 50);
    expect(last.runs).toHaveLength(20);
    expect(last.nextCursor).toBeNull();
    expect(
      new Set([...first.runs, ...second.runs, ...last.runs].map((r) => r.id))
        .size,
    ).toBe(120);
    expect((await readRunPage(f.client, 99, undefined, 50)).runs).toEqual([]);
  });
});
