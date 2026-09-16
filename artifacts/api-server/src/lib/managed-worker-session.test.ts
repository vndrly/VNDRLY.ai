import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rows: [{ version: 2 }] as { version: number }[], fail: false }));
vi.mock("@workspace/db", async () => ({ ...(await import("@workspace/db/schema")), db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => { if (state.fail) throw new Error("offline"); return state.rows; } }) }) }) } }));
import { managedWorkerSessionIsCurrent } from "./managed-worker-session";
const session = { userId: 5, sv: 2, exp: Math.floor(Date.now() / 1000) + 600, managedSubcontractor: { siteGrants: [] } };
beforeEach(() => { state.rows = [{ version: 2 }]; state.fail = false; });
it("allows the current managed worker session", async () => { expect(await managedWorkerSessionIsCurrent(session)).toBe(true); });
it("rejects revoked and missing users", async () => { state.rows = [{ version: 3 }]; expect(await managedWorkerSessionIsCurrent(session)).toBe(false); state.rows = []; expect(await managedWorkerSessionIsCurrent(session)).toBe(false); });
it("fails closed on unavailable revocation state or expired tokens", async () => { state.fail = true; expect(await managedWorkerSessionIsCurrent(session)).toBe(false); expect(await managedWorkerSessionIsCurrent({ ...session, exp: 1 })).toBe(false); });
