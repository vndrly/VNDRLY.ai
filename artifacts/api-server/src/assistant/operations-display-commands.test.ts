import { expect, it, vi } from "vitest";
import { createOperationsDisplayCommands, type DisplayCommandActor, type DisplayCommandDependencies, type DisplayCommandReceipt } from "./operations-display-commands";
import type { OperationsDisplay, OperationsDisplayOutput } from "../services/operations-displays";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const then = new Date("2026-10-07T10:00:00Z"), now = new Date("2026-10-07T10:01:00Z");
const actor: DisplayCommandActor = { userId: 17, membershipId: 12, sessionVersion: 1, owner: { type: "vendor", id: 4 } };
const route = { operationId: id(3), displayId: id(1), expectedUpdatedAt: then.toISOString(), reason: "Show the selected authorized Gate", action: "route", monitorName: "Left", view: "gate_log", siteLocationId: 392 };
function fixture() {
  let state: { display: OperationsDisplay; outputs: OperationsDisplayOutput[] } = {
    display: { id: id(1), owner: actor.owner, name: "Office display", kind: "operations_display", registeredByUserId: 17, registeredCompanionDeviceId: id(2), siteAllowlist: [392], viewAllowlist: ["gate_log", "meeting_room"], privacyMode: true, tokenHash: "private-pairing-hash", tokenExpiresAt: now, revokedAt: null, revokedByUserId: null, createdAt: then, updatedAt: then },
    outputs: ["Left", "Right"].map((name, i) => ({ id: id(10 + i), displayId: id(1), name, currentView: null, currentSiteLocationId: null, currentMeetingOccurrenceId: null, cameraEnabled: false, microphoneEnabled: false, updatedAt: then })),
  };
  const receipts = new Map<string, DisplayCommandReceipt>(), audit: Array<{ reason: string; actorUserId: number }> = [];
  let tail = Promise.resolve();
  const authorize = vi.fn(async () => ({ companionDeviceId: id(2) }));
  const commit = vi.fn();
  const deps: DisplayCommandDependencies = {
    now: () => now, authorize,
    async withLockedCommand(command, _actor, operation) {
      const previous = tail; let release!: () => void; tail = new Promise(resolve => { release = resolve; }); await previous;
      try {
        return await operation({ state: structuredClone(state), prior: receipts.get(command.operationId) ?? null, async commit(next, receipt, reason) {
          await commit(next, receipt, reason);
          state = structuredClone(next); receipts.set(command.operationId, structuredClone(receipt)); audit.push({ reason, actorUserId: receipt.actorUserId });
        } });
      } finally { release(); }
    },
  };
  return { commands: createOperationsDisplayCommands(deps), authorize, commit, audit, receipts, get state() { return state; } };
}
it("prepares no effect and rejects model companion identity or pairing fields", () => {
  const f = fixture(); expect(f.commands.prepare(route)).toMatchObject({ submitted: false, physicalDisplayVerified: false });
  for (const field of ["companionDeviceId", "token", "confirmed"]) expect(() => f.commands.prepare({ ...route, [field]: "model" })).toThrow();
  expect(f.commit).not.toHaveBeenCalled();
});
it("routes one monitor atomically with exact receipt/audit, preserving other outputs and media state", async () => {
  const f = fixture(), before = structuredClone(f.state.outputs[1]);
  const receipt = await f.commands.execute(route, actor);
  expect(receipt).toMatchObject({ operationId: route.operationId, actorUserId: 17, status: "applied", physicalDisplayVerified: false, cameraStarted: false, microphoneStarted: false });
  expect(JSON.stringify(receipt)).not.toContain("pairing");
  expect(f.state.outputs[0]).toMatchObject({ currentView: "gate_log", currentSiteLocationId: 392, currentMeetingOccurrenceId: null, cameraEnabled: false, microphoneEnabled: false });
  expect(f.state.outputs[1]).toEqual(before); expect(f.audit).toEqual([{ reason: route.reason, actorUserId: 17 }]);
});
it("serializes concurrent exact retries once and reads back a dropped committed result without rebasing", async () => {
  const f = fixture(), [a, b] = await Promise.all([f.commands.execute(route, actor), f.commands.execute(route, actor)]);
  expect(a).toEqual(b); expect(f.commit).toHaveBeenCalledOnce();
  expect(await f.commands.readback(route, actor)).toEqual(a);
  await expect(f.commands.execute({ ...route, reason: "Different intent" }, actor)).rejects.toThrow("operation_conflict");
  await expect(f.commands.execute({ ...route, expectedUpdatedAt: now.toISOString() }, actor)).rejects.toThrow("operation_conflict");
});
it("rechecks current persisted authority on readback and replay instead of trusting prior approval", async () => {
  const f = fixture(); await f.commands.execute(route, actor);
  f.authorize.mockRejectedValue(Error("Current membership or site revoked"));
  await expect(f.commands.readback(route, actor)).rejects.toThrow("revoked");
  await expect(f.commands.execute(route, actor)).rejects.toThrow("revoked"); expect(f.commit).toHaveBeenCalledOnce();
});
it("rejects foreign owner/actor, untrusted companion, stale version and unauthorized monitors/sites", async () => {
  const f = fixture();
  await expect(f.commands.execute(route, { ...actor, owner: { type: "vendor", id: 5 } })).rejects.toThrow("not_found");
  await expect(f.commands.execute(route, { ...actor, userId: 18 })).rejects.toThrow("not_found");
  f.authorize.mockResolvedValueOnce({ companionDeviceId: id(99) });
  await expect(f.commands.execute(route, actor)).rejects.toThrow("trusted_companion");
  await expect(f.commands.execute({ ...route, expectedUpdatedAt: now.toISOString() }, actor)).rejects.toThrow("version_conflict");
  await expect(f.commands.execute({ ...route, monitorName: "Unknown" }, actor)).rejects.toThrow("monitor_not_found");
  await expect(f.commands.execute({ ...route, siteLocationId: 999 }, actor)).rejects.toThrow("site_not_allowed");
  expect(f.commit).not.toHaveBeenCalled();
});
it("room routing records only the authorized occurrence and never starts camera/microphone", async () => {
  const f = fixture(); await f.commands.execute({ operationId: id(4), displayId: id(1), expectedUpdatedAt: then.toISOString(), reason: "Display the authorized room", action: "join_room", monitorName: "Right", meetingOccurrenceId: id(20) }, actor);
  expect(f.state.outputs[1]).toMatchObject({ currentView: "meeting_room", currentSiteLocationId: null, currentMeetingOccurrenceId: id(20), cameraEnabled: false, microphoneEnabled: false });
  expect(f.authorize).toHaveBeenCalledWith(expect.any(Object), actor, expect.objectContaining({ meetingOccurrenceId: id(20) }));
});
it("preserves state/audit on persistence failure and returns proven absence without writing", async () => {
  const f = fixture(), before = structuredClone(f.state); expect(await f.commands.readback(route, actor)).toBeNull();
  f.commit.mockRejectedValue(Error("Transaction rollback")); await expect(f.commands.execute(route, actor)).rejects.toThrow("rollback");
  expect(f.state).toEqual(before); expect(f.receipts.size).toBe(0); expect(f.audit).toHaveLength(0);
});
it("revokes once, preserves all monitor configuration and refuses later new commands", async () => {
  const f = fixture(), before = structuredClone(f.state.outputs), request = { operationId: id(5), displayId: id(1), expectedUpdatedAt: then.toISOString(), reason: "Stop displaying company records", action: "revoke" };
  const receipt = await f.commands.execute(request, actor); expect(await f.commands.execute(request, actor)).toEqual(receipt);
  expect(f.state.display).toMatchObject({ revokedAt: now, revokedByUserId: 17 }); expect(f.state.outputs).toEqual(before);
  await expect(f.commands.execute({ ...route, operationId: id(6), expectedUpdatedAt: now.toISOString() }, actor)).rejects.toThrow("revoked");
});
it("advances timestamp CAS under a fixed clock and refuses a second stale reviewed intent", async () => {
  const f = fixture(); await f.commands.execute(route, actor);
  const second = { ...route, operationId: id(30), expectedUpdatedAt: now.toISOString(), monitorName: "Right" };
  await f.commands.execute(second, actor);
  expect(f.state.display.updatedAt.getTime()).toBe(now.getTime() + 1);
  await expect(f.commands.execute({ ...second, operationId: id(31), monitorName: "Left" }, actor)).rejects.toThrow("version_conflict");
  expect(f.receipts.get(id(30))?.recordedAt).toBe(now.toISOString());
});
