import { describe, expect, it } from "vitest";
import type { FleetActionInput } from "@workspace/api-zod";
import { createFleetOfflineStore, fleetOfflineByteLength, replayFleetSequence } from "./fleet-offline";
const scope = { userId: 1069, companyId: 609, membershipId: 1 };
const base = { runId: "20000000-0000-4000-8000-000000000001", companyId: 609, driverUserId: 1069, vehicleAssetId: "30000000-0000-4000-8000-000000000001", trailerAssetId: null, version: 7 };
function fixture() {
  const records = new Map<string, string>();
  return createFleetOfflineStore({ getItem: async key => records.get(key) ?? null, setItem: async (key, value) => { records.set(key, value); }, removeItem: async key => { records.delete(key); } });
}
describe("Fleet scoped offline actions", () => {
  it("preserves ordered immutable operations/revisions and separates accounts", async () => {
    const queue = fixture();
    const input = { operationId: "10000000-0000-4000-8000-000000000001", expectedVersion: 7, action: "inspect", notes: "Light fault", inspectionOutcome: "defect_reported" } as FleetActionInput;
    await queue.enqueue(scope, { base, runId: base.runId, input, capturedAt: "2026-10-07T12:00:00Z", state: "unsynced" });
    expect((await queue.read(scope)).actions[0].input).toEqual(input);
    expect((await queue.read({ ...scope, companyId: 610 })).actions).toEqual([]);
    await expect(queue.enqueue(scope, { base, runId: base.runId, input: { ...input, operationId: "10000000-0000-4000-8000-000000000002" }, capturedAt: "2026-10-07T12:01:00Z", state: "unsynced" })).rejects.toThrow("contiguous");
    await queue.enqueue(scope, { base, runId: base.runId, input: { ...input, expectedVersion: 8, operationId: "10000000-0000-4000-8000-000000000002" }, capturedAt: "2026-10-07T12:01:00Z", state: "unsynced" });
    expect((await queue.read(scope)).actions.map(item => item.input.expectedVersion)).toEqual([7, 8]);
    await queue.resolve(scope, "10000000-0000-4000-8000-000000000001", "revoked", "Grant removed");
    expect((await queue.read(scope)).actions.map(item => item.state)).toEqual(["revoked", "revoked"]);
    await queue.clear(scope);
    expect((await queue.read(scope)).actions).toEqual([]);
  });
  it("measures UTF8 bytes so multibyte notes cannot bypass the secure storage bound", () => {
    expect(fleetOfflineByteLength("abc")).toBe(3);
    expect(fleetOfflineByteLength("é中🚚")).toBe(9);
  });
});

describe("ordered Fleet replay", () => {
  const inputs = ["arrive_stop", "record_load", "depart_stop", "arrive_stop", "record_delivery"].map((action, index) => ({ base, runId: base.runId, capturedAt: "2026-10-07T12:00:00Z", state: "unsynced" as const, input: { action, expectedVersion: 7 + index, operationId: `10000000-0000-4000-8000-00000000000${index + 1}` } as FleetActionInput }));
  it("submits the same ordered UUIDs and exact predicted revisions only after readback", async () => {
    let saved = { ...base, id: base.runId, events: [] as { operationId: string }[] };
    const submitted: FleetActionInput[] = []; const accepted: string[] = [];
    await replayFleetSequence(inputs, { readRun: async () => saved as never, submit: async (_, input) => { submitted.push(input); saved = { ...saved, version: saved.version + 1, events: [...saved.events, { operationId: input.operationId }] }; return saved as never; }, resolve: async (id, state) => { expect(state).toBe("accepted"); accepted.push(id); } });
    expect(submitted.map(item => item.expectedVersion)).toEqual([7,8,9,10,11]);
    expect(accepted).toEqual(inputs.map(item => item.input.operationId));
  });
  it("recovers a dropped response after an accepted prefix without replaying or rebasing saved facts", async () => {
    const queue = fixture(); for (const item of inputs) await queue.enqueue(scope, item);
    let saved = { ...base, id: base.runId, events: [] as {operationId:string}[] };
    const calls: string[] = []; let drop = true;
    const transport = { readRun: async () => saved as never, submit: async (_: string, input: FleetActionInput) => {
      calls.push(input.operationId); saved = { ...saved, version:saved.version+1, events:[...saved.events,{operationId:input.operationId}] };
      if (calls.length === 2 && drop) { drop=false; throw new Error("response lost"); } return saved as never;
    }, resolve: async (id: string, state: "accepted"|"conflict"|"revoked", message?:string) => queue.resolve(scope,id,state,message) };
    await expect(replayFleetSequence((await queue.read(scope)).actions,transport)).rejects.toThrow("response lost");
    expect((await queue.read(scope)).actions[0].input.expectedVersion).toBe(8);
    await replayFleetSequence((await queue.read(scope)).actions,transport);
    expect(calls).toEqual(inputs.map(item=>item.input.operationId));
    expect((await queue.read(scope)).actions).toEqual([]);
  });
  it("stops before a submit on reassignment or an external revision instead of rebasing", async () => {
    for (const changed of [{ driverUserId: 1070 }, { version: 8 }]) {
      let submits = 0; const states: string[] = [];
      await replayFleetSequence(inputs, { readRun: async () => ({ ...base, id: base.runId, ...changed, events: [] }) as never, submit: async () => { submits++; throw new Error("unexpected"); }, resolve: async (_, state) => { states.push(state); } });
      expect(submits).toBe(0); expect(states).toEqual(["conflict"]);
    }
  });
  it("stops the sequence on a server hold or revocation", async () => {
    for (const status of [409,403]) {
      let submits = 0; const states: string[] = [];
      await expect(replayFleetSequence(inputs, { readRun: async () => ({ ...base, id: base.runId, events: [] }) as never, submit: async () => { submits++; throw Object.assign(new Error("refused"), { status }); }, resolve: async (_, state) => { states.push(state); } })).rejects.toThrow("refused");
      expect(submits).toBe(1); expect(states).toEqual([status === 403 ? "revoked" : "conflict"]);
    }
  });
});

it("retains refused facts when the server verified session changes and refuses replay under a different session",async()=>{
  const queue=fixture(),firstScope={...scope,sessionVersion:1};await queue.bindAccount(firstScope);
  const item={base,runId:base.runId,input:{action:"acknowledge",operationId:"10000000-0000-4000-8000-000000000001",expectedVersion:7} as FleetActionInput,capturedAt:"2026-10-07T12:00:00Z",state:"unsynced" as const};
  await queue.enqueue(firstScope,item);
  await queue.bindAccount({...scope,sessionVersion:2});
  const document=await queue.read({...scope,sessionVersion:2});
  expect(document.actions).toHaveLength(1);expect(document.actions[0]).toMatchObject({state:"revoked",sessionVersion:1});expect(document.overview).toBeNull();
  let reads=0;const outcomes:string[]=[];
  await replayFleetSequence([{...document.actions[0],state:"unsynced"}],{scope:{...scope,sessionVersion:2},readRun:async()=>{reads++;throw new Error("unexpected");},submit:async()=>{throw new Error("unexpected");},resolve:async(_,state)=>{outcomes.push(state);}});
  expect(reads).toBe(0);expect(outcomes).toEqual(["revoked"]);
});
