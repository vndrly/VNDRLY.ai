import { describe, expect, it } from "vitest";
import { createAudioLeaseService, InMemoryAudioLeaseStore, selectFailoverCandidate, AudioLeaseError } from "./audio-lease";

const occurrenceId = "17795fa1-bb5f-4abc-a5f8-7e9b33a0ea41";
const actor = { occurrenceId, userId: 7, deviceId: "17795fa1-bb5f-4abc-a5f8-7e9b33a0ea42" };
const desktopId = "17795fa1-bb5f-4abc-a5f8-7e9b33a0ea43";

describe("cross-device audio lease", () => {
  it("keeps the source active while an explicit handoff waits for destination confirmation", async () => {
    const service = createAudioLeaseService(new InMemoryAudioLeaseStore(), { token: (() => { let i = 0; return () => `token-${++i}`; })() });
    const phone = await service.acquire(actor);
    const offer = await service.offerHandoff(actor, phone.token, desktopId);
    expect(await service.validate(actor, phone.token, phone.generation)).toBe(true);
    expect(offer.destinationDeviceId).toBe(desktopId);
  });

  it("never gives two devices a valid transmit generation", async () => {
    const service = createAudioLeaseService(new InMemoryAudioLeaseStore(), { token: (() => { let i = 0; return () => `token-${++i}`; })() });
    const phone = await service.acquire(actor);
    const offer = await service.offerHandoff(actor, phone.token, desktopId);
    const desktop = await service.acceptHandoff({ ...actor, deviceId: desktopId }, offer.offerToken);
    expect(await service.validate(actor, phone.token, phone.generation)).toBe(false);
    expect(await service.validate({ ...actor, deviceId: desktopId }, desktop.token, desktop.generation)).toBe(true);
  });

  it("rejects acquisition while the attendee is host-muted", async () => {
    const service = createAudioLeaseService(new InMemoryAudioLeaseStore());
    await expect(service.acquire({ ...actor, hostMuted: true })).rejects.toMatchObject({ code: "meeting.host_muted" } satisfies Partial<AudioLeaseError>);
  });

  it("excludes offline, unpermitted, or unauthorized automatic backups", () => {
    const now = Date.now();
    const devices = [
      { deviceId: desktopId, connectionId: "a", seenAt: now, microphonePermission: "granted" as const },
      { deviceId: "denied", connectionId: "b", seenAt: now, microphonePermission: "denied" as const },
      { deviceId: "stale", connectionId: "c", seenAt: now - 60_000, microphonePermission: "granted" as const },
    ];
    expect(selectFailoverCandidate(devices, { rankedDeviceIds: [desktopId, "denied", "stale"], automaticBackupDeviceIds: [] }, now)).toBeNull();
    expect(selectFailoverCandidate(devices, { rankedDeviceIds: [desktopId, "denied", "stale"], automaticBackupDeviceIds: [desktopId] }, now)?.deviceId).toBe(desktopId);
  });

  it("releases ownership and lets an authorized backup fence the old generation after the warning", async () => {
    let clock = new Date("2026-09-12T12:00:00.000Z");
    const service = createAudioLeaseService(new InMemoryAudioLeaseStore(), { now: () => clock, token: (() => { let i = 0; return () => `token-${++i}`; })() });
    const phone = await service.acquire(actor);
    await service.release(actor, phone.token, phone.generation);
    await service.prepareFailover({ ...actor, deviceId: desktopId }, phone.generation);
    await expect(service.activateFailover({ ...actor, deviceId: desktopId }, phone.generation)).rejects.toMatchObject({ code: "audio.failover_warning" });
    clock = new Date(clock.getTime() + 3_000);
    const desktop = await service.activateFailover({ ...actor, deviceId: desktopId }, phone.generation);
    expect(desktop.generation).toBe(phone.generation + 1);
    await expect(service.renew(actor, phone.token, phone.generation)).rejects.toMatchObject({ code: "audio.invalid_lease" });
  });

  it("does not fail over while a current owner is still alive", async () => {
    const service = createAudioLeaseService(new InMemoryAudioLeaseStore());
    const phone = await service.acquire(actor);
    await expect(service.activateFailover({ ...actor, deviceId: desktopId }, phone.generation)).rejects.toMatchObject({ code: "audio.in_use" });
  });

  it("rejects direct failover activation without a server-issued warning", async () => {
    const service = createAudioLeaseService(new InMemoryAudioLeaseStore());
    const phone = await service.acquire(actor);
    await service.release(actor, phone.token, phone.generation);
    await expect(service.activateFailover({ ...actor, deviceId: desktopId }, phone.generation)).rejects.toMatchObject({ code: "audio.invalid_offer" });
  });

  it("fences an active microphone lease immediately for moderation or device revocation", async () => {
    const service = createAudioLeaseService(new InMemoryAudioLeaseStore());
    const phone = await service.acquire(actor);
    const fenced = await service.fence(occurrenceId, actor.userId);
    expect(fenced.generation).toBe(phone.generation + 1);
    await expect(service.renew(actor, phone.token, phone.generation)).rejects.toMatchObject({ code: "audio.invalid_lease" });
  });

  it("lets only the offered destination decline a pending handoff", async () => {
    const service = createAudioLeaseService(new InMemoryAudioLeaseStore(), { token: (() => { let i = 0; return () => `token-${++i}`; })() });
    const phone = await service.acquire(actor);
    await service.offerHandoff(actor, phone.token, desktopId);
    await expect(service.declineHandoff(actor)).rejects.toMatchObject({ code: "audio.invalid_offer" });
    await expect(service.declineHandoff({ ...actor, deviceId: desktopId })).resolves.toEqual({ declined: true });
  });

  it("lets an authenticated destination request and accept a one-tap handoff without exposing a capability token", async () => {
    const service = createAudioLeaseService(new InMemoryAudioLeaseStore(), { token: (() => { let i = 0; return () => `token-${++i}`; })() });
    await service.acquire(actor);
    const offer = await service.requestHandoff({ ...actor, deviceId: desktopId });
    expect(offer).not.toHaveProperty("offerToken");
    await expect(service.acceptHandoff({ ...actor, deviceId: desktopId })).resolves.toMatchObject({ generation: 2 });
  });
});
