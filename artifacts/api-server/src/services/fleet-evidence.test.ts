import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FleetRunSchema } from "@workspace/api-zod";
import type { PoolClient } from "pg";
import type { ObjectStore, StoredObject } from "../lib/objectStore";
import type { FleetActor } from "./fleet-ops";
import { emptyFleetState, type FleetState } from "./fleet-repository";
import { createFleetEvidenceOperations } from "./fleet-evidence";
function fixture() {
  const run = FleetRunSchema.parse({
    id: randomUUID(),
    fleetId: randomUUID(),
    companyId: 7,
    title: "Synthetic",
    driverUserId: 2,
    vehicleAssetId: randomUUID(),
    trailerAssetId: null,
    siteIds: [9],
    status: "in_progress",
    phase: "at_pickup",
    version: 1,
    stops: [{ id: randomUUID(), siteId: 9, kind: "pickup", sequence: 0 }],
    loads: [],
    inspections: [],
    currentStopId: null,
    visitedStopIds: [],
    events: [],
    linkedTicketId: null,
    allowedActions: [],
  });
  let state = { ...emptyFleetState(), enabled: true, runs: [run] },
    authorized = true,
    failAudit = false,
    writes = 0;
  const actor: FleetActor = { userId: 2, companyId: 7 },
    path = `/objects/uploads/${randomUUID()}`,
    objects = new Map<string, StoredObject>([
      [
        path,
        {
          contentType: "image/jpeg",
          size: 4,
          body: Buffer.from([255, 216, 255, 1]),
          acl: { owner: "2", visibility: "private" },
        },
      ],
    ]),
    records = new Map<string, unknown>();
  const client = {
    query: async (sql: string, args: unknown[] = []) => {
      if (sql.startsWith("INSERT")) {
        if (failAudit) throw Error("Synthetic audit failure");
        records.set(String(args[2]), JSON.parse(String(args[3])));
        return { rows: [] };
      }
      if (sql.startsWith("SELECT count"))
        return { rows: [{ count: records.size }] };
      if (sql.includes("operationId"))
        return {
          rows: [...records.values()]
            .filter(
              (value) =>
                (value as { record: { operationId: string } }).record
                  .operationId === args[1],
            )
            .map((tool_output) => ({ tool_output })),
        };
      return {
        rows: records.has(String(args[1]))
          ? [{ tool_output: records.get(String(args[1])) }]
          : [],
      };
    },
  } as unknown as PoolClient;
  const store = {
    getObject: async (key: string) => objects.get(key) ?? null,
    putObject: async (
      key: string,
      type: string,
      body: Buffer,
      acl: StoredObject["acl"],
    ) => {
      writes++;
      objects.set(key, { contentType: type, size: body.length, body, acl });
    },
  } as unknown as ObjectStore;
  const tx = async <T>(
    bound: FleetActor,
    op: (state: FleetState, client: PoolClient) => Promise<T>,
  ) => {
    bound.activeSiteIds = [9];
    const next = structuredClone(state);
    const result = await op(next, client);
    state = next;
    return result;
  };
  const service = createFleetEvidenceOperations(
    tx,
    (_s, b, r, action) =>
      authorized &&
      b.companyId === r.companyId &&
      (action === "view" || b.userId === r.driverUserId),
    () => store,
  );
  const input = {
    operationId: randomUUID(),
    expectedVersion: 1,
    evidenceId: randomUUID(),
    objectPath: path,
    kind: "signature",
    notes: "User-reported signature image",
  };
  return {
    actor,
    run,
    input,
    service,
    objects,
    records,
    get writes() {
      return writes;
    },
    state: () => state,
    revoke: () => {
      authorized = false;
    },
    fail: () => {
      failAudit = true;
    },
    recover: () => {
      failAudit = false;
    },
  };
}
describe("Fleet immutable device evidence association", () => {
  it("copies actual owned private bytes, binds exact operation and survives source deletion on replay", async () => {
    const f = fixture(),
      saved = await f.service.addEvidence(f.actor, f.run.id, f.input);
    expect(saved).toMatchObject({
      source: "device_upload",
      physicalProofVerified: false,
      signatureIdentityVerified: false,
      runVersion: 2,
      size: 4,
    });
    f.objects.delete(f.input.objectPath);
    expect(await f.service.addEvidence(f.actor, f.run.id, f.input)).toEqual(
      saved,
    );
    expect(f.writes).toBe(1);
    expect(f.state().runs[0].events).toHaveLength(1);
    expect(
      (await f.service.evidenceFile(f.actor, f.run.id, f.input.evidenceId))
        .object.body,
    ).toEqual(Buffer.from([255, 216, 255, 1]));
    f.revoke();
    await expect(
      f.service.evidenceFile(f.actor, f.run.id, f.input.evidenceId),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("requires current own assignment/private uploader ownership and refuses public or unsupported content", async () => {
    const f = fixture();
    await expect(
      f.service.addEvidence({ ...f.actor, userId: 3 }, f.run.id, f.input),
    ).rejects.toMatchObject({ status: 403 });
    f.objects.get(f.input.objectPath)!.acl!.visibility = "public";
    await expect(
      f.service.addEvidence(f.actor, f.run.id, f.input),
    ).rejects.toMatchObject({ status: 403 });
    f.objects.get(f.input.objectPath)!.acl!.visibility = "private";
    f.objects.get(f.input.objectPath)!.contentType = "text/html";
    await expect(
      f.service.addEvidence(f.actor, f.run.id, f.input),
    ).rejects.toMatchObject({ status: 400 });
    expect(f.writes).toBe(0);
  });
  it("does not claim association on database failure and recovers identical orphan copy without overwrite", async () => {
    const f = fixture();
    f.fail();
    await expect(
      f.service.addEvidence(f.actor, f.run.id, f.input),
    ).rejects.toThrow("Synthetic audit failure");
    expect(f.records.size).toBe(0);
    expect(f.state().runs[0].version).toBe(1);
    expect(f.writes).toBe(1);
    f.recover();
    await f.service.addEvidence(f.actor, f.run.id, f.input);
    expect(f.writes).toBe(1);
    expect(f.records.size).toBe(1);
  });
  it("refuses stale revision, foreign stop/load or differing orphan bytes before any overwrite", async () => {
    const f = fixture();
    await expect(
      f.service.addEvidence(f.actor, f.run.id, {
        ...f.input,
        expectedVersion: 2,
      }),
    ).rejects.toMatchObject({ code: "fleet.version_conflict" });
    await expect(
      f.service.addEvidence(f.actor, f.run.id, {
        ...f.input,
        stopId: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 400 });
    f.fail();
    await expect(
      f.service.addEvidence(f.actor, f.run.id, f.input),
    ).rejects.toThrow();
    f.recover();
    f.objects.get(f.input.objectPath)!.body = Buffer.from([255, 216, 255, 2]);
    await expect(
      f.service.addEvidence(f.actor, f.run.id, f.input),
    ).rejects.toMatchObject({ code: "fleet.operation_conflict" });
    expect(f.writes).toBe(1);
  });
});
