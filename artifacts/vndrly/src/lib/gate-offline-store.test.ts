import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => new Map<string, string>());
vi.mock("./fleet-work-journal-web", () => ({
  openWebFleetWorkStorage: async (identity: string) => ({
    transaction: async (work: (tx: unknown) => Promise<unknown>) =>
      work({
        get: async (kind: string, key: string) => rows.get(`${identity}|${kind}:${key}`) ?? null,
        set: async (kind: string, key: string, value: string) => { rows.set(`${identity}|${kind}:${key}`, value); },
        values: async (kind: string) => [...rows].filter(([key]) => key.startsWith(`${identity}|${kind}:`)).map(([, value]) => value),
      }),
  }),
}));

import {
  OFFLINE_SIGN_IN_MS,
  confirmGateSignIn,
  forgetGatePassword,
  gateOfflineMayHold,
  gateReadWithOfflineFallback,
  heldGateSignIn,
  listGateOfflineEntries,
  offlineGateSignIn,
  rememberGateSignIn,
  releaseGateSignIn,
  retainedGateSignIn,
  retryGateOfflineEntry,
  saveGateOfflineEntry,
  uploadGateOfflineEntries,
} from "./gate-offline-store";

const user = { userId: 7, activeMembershipId: 9, vendorId: 11, partnerId: null };
const profile = { ...user, displayName: "Gate Keeper", mustChangePassword: false };
const offline = () => new TypeError("Failed to fetch");
const refused = (status: number, message = "Refused") => Object.assign(new Error(message), { status });
const entry = (firstName: string) => ({
  label: `${firstName} Webb`,
  payload: { siteLocationId: 3, direction: "entry" as const, reportedVisitor: { firstName, lastName: "Webb" } },
});

beforeEach(() => { rows.clear(); localStorage.clear(); forgetGatePassword(); });
afterEach(() => { vi.useRealTimers(); });

describe("offline sign-in on this computer", () => {
  it("accepts a username and password the server accepted here, without storing either", async () => {
    await rememberGateSignIn("Keeper@Example.com", "correct horse", profile);
    expect(await offlineGateSignIn(" keeper@example.com ", "correct horse")).toMatchObject({ userId: 7 });
    expect(heldGateSignIn()).toEqual({ username: " keeper@example.com ", password: "correct horse" });
    const stored = [...rows.entries()].flat().join(" ");
    expect(stored).not.toContain("correct horse");
    expect(stored.toLowerCase()).not.toContain("keeper@example.com");
  });

  it("refuses a wrong password and a username never accepted here", async () => {
    await rememberGateSignIn("keeper", "correct horse", profile);
    expect(await offlineGateSignIn("keeper", "wrong")).toBeNull();
    expect(await offlineGateSignIn("stranger", "correct horse")).toBeNull();
    expect(heldGateSignIn()).toBeNull();
  });

  it("stays good for 30 days from the server's last confirmation, and no longer", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
    await rememberGateSignIn("keeper", "correct horse", profile);
    vi.setSystemTime(Date.now() + OFFLINE_SIGN_IN_MS - 60_000);
    expect(await offlineGateSignIn("keeper", "correct horse")).not.toBeNull();
    await confirmGateSignIn({ ...profile, displayName: "Renamed" });
    vi.setSystemTime(Date.now() + OFFLINE_SIGN_IN_MS - 60_000);
    expect(await offlineGateSignIn("keeper", "correct horse")).toMatchObject({ displayName: "Renamed" });
    vi.setSystemTime(Date.now() + 120_000);
    expect(await offlineGateSignIn("keeper", "correct horse")).toBeNull();
    expect(await retainedGateSignIn()).toBeNull();
  });

  it("is not renewed by another person's session, and a temporary password is not remembered", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
    await rememberGateSignIn("keeper", "correct horse", profile);
    await rememberGateSignIn("temp", "temporary", { ...profile, userId: 8, mustChangePassword: true });
    expect(await offlineGateSignIn("temp", "temporary")).toBeNull();
    vi.setSystemTime(Date.now() + OFFLINE_SIGN_IN_MS - 60_000);
    await confirmGateSignIn({ ...profile, userId: 99 });
    vi.setSystemTime(Date.now() + 120_000);
    expect(await offlineGateSignIn("keeper", "correct horse")).toBeNull();
  });

  it("keeps the last person signed in until they sign out", async () => {
    expect(await retainedGateSignIn()).toBeNull();
    await rememberGateSignIn("keeper", "correct horse", profile);
    expect(await retainedGateSignIn()).toMatchObject({ userId: 7 });
    await releaseGateSignIn();
    expect(await retainedGateSignIn()).toBeNull();
    // The password still signs them in with no connection.
    expect(await offlineGateSignIn("keeper", "correct horse")).toMatchObject({ userId: 7 });
    expect(await retainedGateSignIn()).toMatchObject({ userId: 7 });
  });

  it("stops accepting a password the server refused once the connection was back", async () => {
    await rememberGateSignIn("keeper", "correct horse", profile);
    await releaseGateSignIn(true);
    expect(await retainedGateSignIn()).toBeNull();
    expect(await offlineGateSignIn("keeper", "correct horse")).toBeNull();
  });
});

describe("the Gate's last-read data", () => {
  it("answers with what was last read when there is no connection", async () => {
    expect(await gateReadWithOfflineFallback(user, "gate.sites", async () => ["North Gate"])).toEqual(["North Gate"]);
    await vi.waitFor(() => expect([...rows.keys()].some((key) => key.endsWith("read:gate.sites"))).toBe(true));
    expect(await gateReadWithOfflineFallback(user, "gate.sites", async () => { throw offline(); })).toEqual(["North Gate"]);
    await expect(gateReadWithOfflineFallback({ ...user, userId: 8 }, "gate.sites", async () => { throw offline(); })).rejects.toThrow("Failed to fetch");
  });

  it("never answers a server refusal with what was kept, and drops it", async () => {
    await gateReadWithOfflineFallback(user, "gate.refused", async () => ["North Gate"]);
    await vi.waitFor(() => expect([...rows.keys()].some((key) => key.endsWith("read:gate.refused"))).toBe(true));
    await expect(gateReadWithOfflineFallback(user, "gate.refused", async () => { throw refused(500); })).rejects.toMatchObject({ status: 500 });
    await expect(gateReadWithOfflineFallback(user, "gate.refused", async () => { throw refused(403); })).rejects.toMatchObject({ status: 403 });
    await vi.waitFor(() => expect([...rows].find(([key]) => key.endsWith("read:gate.refused"))?.[1]).toBe(""));
    await expect(gateReadWithOfflineFallback(user, "gate.refused", async () => { throw offline(); })).rejects.toThrow("Failed to fetch");
  });

  it("does not answer with data older than 30 days", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
    await gateReadWithOfflineFallback(user, "gate.old", async () => 1);
    await vi.waitFor(() => expect([...rows.keys()].some((key) => key.endsWith("read:gate.old"))).toBe(true));
    vi.setSystemTime(Date.now() + OFFLINE_SIGN_IN_MS + 1000);
    await expect(gateReadWithOfflineFallback(user, "gate.old", async () => { throw offline(); })).rejects.toThrow("Failed to fetch");
  });
});

describe("check-ins and check-outs waiting to upload", () => {
  it("keeps each record until the server takes it, oldest first", async () => {
    expect(gateOfflineMayHold(user)).toBe(false);
    const first = await saveGateOfflineEntry(user, entry("Alan"));
    const second = await saveGateOfflineEntry(user, entry("Maria"));
    expect(gateOfflineMayHold(user)).toBe(true);
    expect((await listGateOfflineEntries(user)).map((row) => row.state)).toEqual(["pending", "pending"]);
    // Still no connection: nothing is lost and nothing is marked failed.
    const send = vi.fn(async () => { throw offline(); });
    expect((await uploadGateOfflineEntries(user, send)).map((row) => row.state)).toEqual(["pending", "pending"]);
    expect(send).toHaveBeenCalledTimes(1);
    const sent: string[] = [];
    expect(await uploadGateOfflineEntries(user, async (row) => { sent.push(row.operationId); })).toEqual([]);
    expect(sent.sort()).toEqual([first.operationId, second.operationId].sort());
    expect(gateOfflineMayHold(user)).toBe(false);
    expect(await listGateOfflineEntries({ ...user, userId: 8 })).toEqual([]);
  });

  it("uploads a check-out only after the check-in it closes", async () => {
    const checkIn = await saveGateOfflineEntry(user, entry("Alan"));
    const checkOut = await saveGateOfflineEntry(user, {
      label: "Alan Webb",
      payload: { siteLocationId: 3, direction: "exit", entryOperationId: checkIn.operationId },
    });
    const order: string[] = [];
    let failFirst = true;
    const send = async (row: { operationId: string }) => {
      if (row.operationId === checkIn.operationId && failFirst) { failFirst = false; throw refused(503); }
      order.push(row.operationId);
    };
    expect((await uploadGateOfflineEntries(user, send)).length).toBe(2);
    expect(order).toEqual([]);
    expect(await uploadGateOfflineEntries(user, send)).toEqual([]);
    expect(order).toEqual([checkIn.operationId, checkOut.operationId]);
  });

  it("keeps a record the server will not take, with the reason, and lets it be tried again", async () => {
    const kept = await saveGateOfflineEntry(user, entry("Alan"));
    const after = await uploadGateOfflineEntries(user, async () => { throw refused(403, "gate.role_required"); });
    expect(after).toMatchObject([{ operationId: kept.operationId, state: "revoked", reason: "gate.role_required" }]);
    // Still on this computer, so the Gate still shows it; someone else's records are a separate matter.
    expect(gateOfflineMayHold(user)).toBe(true);
    expect(gateOfflineMayHold({ ...user, userId: 8 })).toBe(false);
    // Left alone until someone asks for another try.
    const send = vi.fn(async () => undefined);
    await uploadGateOfflineEntries(user, send);
    expect(send).not.toHaveBeenCalled();
    await retryGateOfflineEntry(user, kept.operationId);
    expect(await uploadGateOfflineEntries(user, send)).toEqual([]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("marks a record the server already holds differently as a conflict and keeps going", async () => {
    await saveGateOfflineEntry(user, entry("Alan"));
    await saveGateOfflineEntry(user, entry("Maria"));
    let calls = 0;
    const after = await uploadGateOfflineEntries(user, async () => { if (++calls === 1) throw refused(409, "gate.entry_already_closed"); });
    expect(after).toMatchObject([{ label: "Alan Webb", state: "conflict" }]);
    expect(calls).toBe(2);
  });
});
