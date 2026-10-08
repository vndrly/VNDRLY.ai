import { beforeEach, expect, it, vi } from "vitest";
const env = vi.hoisted(() => ({
  current: true,
  stored: {
    id: 9,
    activeMembershipId: 2,
    vendorId: 4,
    partnerId: null as number | null,
    requiresContextChoice: false,
  },
  session: {
    userId: 9,
    activeMembershipId: 2,
    sv: 1,
    role: "vendor",
    vendorId: 4,
    partnerId: null as number | null,
  },
  api: vi.fn(),
  cached: vi.fn(),
  cacheWrite: vi.fn(),
}));
vi.mock("./auth", () => ({
  getUser: async () => env.stored,
  captureAuthScope: () => ({ generation: 1 }),
  isAuthScopeCurrent: () => env.current,
}));
vi.mock("./api", () => ({ apiFetch: env.api }));
vi.mock("./native-assigned-cache", () => ({ readAssignedCache: env.cached, cacheAssignedRead: env.cacheWrite }));
import { currentNativeCaptureContext } from "./native-capture-context";
beforeEach(() => {
  env.current = true;
  env.stored = {
    id: 9,
    activeMembershipId: 2,
    vendorId: 4,
    partnerId: null,
    requiresContextChoice: false,
  };
  env.session = {
    userId: 9,
    activeMembershipId: 2,
    sv: 1,
    role: "vendor",
    vendorId: 4,
    partnerId: null,
  };
  env.api.mockReset().mockImplementation(async () => env.session);
  env.cached.mockReset().mockResolvedValue({ value: env.session });
  env.cacheWrite.mockReset().mockResolvedValue(undefined);
});
it("permits local drafts from the same protected snapshot only for network loss, never authorization refusal", async () => {
  env.api.mockRejectedValue(Object.assign(new Error("offline"), { code: "network.unreachable" }));
  await expect(currentNativeCaptureContext(undefined, false)).rejects.toThrow("offline");
  expect((await currentNativeCaptureContext(undefined, true)).account.userId).toBe(9);
  env.api.mockRejectedValue(Object.assign(new Error("revoked"), { status: 403, code: "auth.forbidden" }));
  await expect(currentNativeCaptureContext(undefined, true)).rejects.toThrow("revoked");
  env.api.mockRejectedValue(Object.assign(new Error("offline"), { code: "network.unreachable" }));
  env.cached.mockResolvedValue({ value: { ...env.session, vendorId: 88 } });
  await expect(currentNativeCaptureContext(undefined, true)).rejects.toThrow("account_changed");
});
it("derives stable context from fresh server-read session while generation remains a separate callback fence", async () => {
  const first = await currentNativeCaptureContext({ generation: 1 });
  const restarted = await currentNativeCaptureContext({ generation: 2 });
  expect(restarted.binding).toBe(first.binding);
  expect(first.account).toEqual({
    userId: 9,
    membershipId: 2,
    sessionVersion: 1,
    orgType: "vendor",
    orgId: 4,
  });
  expect(env.api).toHaveBeenCalledWith("/api/auth/me", {}, { generation: 2 });
  env.current = false;
  expect(first.assertCurrent).toThrow();
});
it("changes durable binding when signed SV or active membership changes", async () => {
  const first = await currentNativeCaptureContext();
  env.session.sv = 2;
  expect((await currentNativeCaptureContext()).binding).not.toBe(first.binding);
  env.session.activeMembershipId = 3;
  await expect(currentNativeCaptureContext()).rejects.toThrow();
});
it("refuses substituted account/company, unresolved context and unsupported platform context", async () => {
  for (const change of [
    () => {
      env.session.userId = 10;
    },
    () => {
      env.session.vendorId = 5;
    },
    () => {
      env.stored.requiresContextChoice = true;
    },
    () => {
      env.session.role = "admin";
    },
  ]) {
    const prior = structuredClone({ stored: env.stored, session: env.session });
    change();
    await expect(currentNativeCaptureContext()).rejects.toThrow();
    env.stored = prior.stored;
    env.session = prior.session;
  }
});
it("derives partner binding from exact matching current partner rather than vendor fallback", async () => {
  env.stored.partnerId = 6;
  env.session = { ...env.session, role: "partner", partnerId: 6 };
  expect((await currentNativeCaptureContext()).account).toMatchObject({
    orgType: "partner",
    orgId: 6,
  });
});
