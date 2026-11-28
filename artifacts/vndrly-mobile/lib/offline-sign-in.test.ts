import { createHash, randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => new Map<string, string>());
vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digestStringAsync: async (_algorithm: string, text: string) => createHash("sha256").update(text).digest("hex"),
  randomUUID: () => randomUUID(),
}));
vi.mock("./work-hub-queue-native", () => ({
  getNativeWorkHubQueueStore: async () => ({
    getItem: async (key: string) => rows.get(key) ?? null,
    setItem: async (key: string, value: string) => { rows.set(key, value); },
  }),
}));

import { confirmSignIn, forgetOfflinePassword, heldOfflineSignIn, offlineSignIn, rememberSignIn } from "./offline-sign-in";

const DAY = 24 * 60 * 60_000;
const user = { id: 7, username: "gate@example.invalid", role: "field_employee", displayName: "Gate Keeper", vendorId: 3 } as any;

beforeEach(() => { rows.clear(); forgetOfflinePassword(); vi.useRealTimers(); });

it("accepts, with no connection, the sign-in the server accepted on this device", async () => {
  await rememberSignIn("Gate@Example.invalid ", "correct horse", user);
  expect(await offlineSignIn("gate@example.invalid", "correct horse")).toEqual(user);
  expect(heldOfflineSignIn()).toEqual({ username: "gate@example.invalid", password: "correct horse" });
});

it("refuses a wrong password and a username that never signed in on this device", async () => {
  await rememberSignIn("gate@example.invalid", "correct horse", user);
  expect(await offlineSignIn("gate@example.invalid", "wrong")).toBeNull();
  expect(await offlineSignIn("other@example.invalid", "correct horse")).toBeNull();
  expect(heldOfflineSignIn()).toBeNull();
});

it("keeps a salted hash, never the password", async () => {
  await rememberSignIn("gate@example.invalid", "correct horse", user);
  expect([...rows.values()].join("\n")).not.toContain("correct horse");
  expect([...rows.keys()].join("\n")).not.toContain("gate@example.invalid");
});

it("stays good for 30 days after the server last confirmed the sign-in on this device", async () => {
  vi.useFakeTimers({ now: new Date("2026-11-01T12:00:00Z") });
  await rememberSignIn("gate@example.invalid", "correct horse", user);
  vi.setSystemTime(Date.now() + 29 * DAY);
  expect(await offlineSignIn("gate@example.invalid", "correct horse")).toEqual(user);
  vi.setSystemTime(Date.now() + 2 * DAY);
  expect(await offlineSignIn("gate@example.invalid", "correct horse")).toBeNull();
});

it("renews the 30 days and the saved profile when the server confirms the session again", async () => {
  vi.useFakeTimers({ now: new Date("2026-11-01T12:00:00Z") });
  await rememberSignIn("gate@example.invalid", "correct horse", user);
  vi.setSystemTime(Date.now() + 20 * DAY);
  await confirmSignIn({ ...user, activeMembershipId: 12 });
  vi.setSystemTime(Date.now() + 20 * DAY);
  expect(await offlineSignIn("gate@example.invalid", "correct horse")).toEqual({ ...user, activeMembershipId: 12 });
});

it("does not renew another person's saved sign-in", async () => {
  vi.useFakeTimers({ now: new Date("2026-11-01T12:00:00Z") });
  await rememberSignIn("gate@example.invalid", "correct horse", user);
  vi.setSystemTime(Date.now() + 20 * DAY);
  await confirmSignIn({ ...user, id: 8 });
  vi.setSystemTime(Date.now() + 20 * DAY);
  expect(await offlineSignIn("gate@example.invalid", "correct horse")).toBeNull();
});

it("does not remember a temporary password that still has to be changed", async () => {
  await rememberSignIn("gate@example.invalid", "temporary", { ...user, mustChangePassword: true });
  expect(await offlineSignIn("gate@example.invalid", "temporary")).toBeNull();
});
