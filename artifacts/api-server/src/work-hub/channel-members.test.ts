import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  rows: [] as unknown[][],
  inserted: [] as unknown[],
  events: [] as string[],
  invalid: false,
  denied: false,
  chat: false,
}));
vi.mock("@workspace/db", async (original) => {
  const tables = await original<Record<string, unknown>>();
  const tx = {
    select: () => {
      const chain: any = {};
      for (const method of ["from", "where", "orderBy", "innerJoin"])
        chain[method] = () => chain;
      chain.for = (mode: string) => {
        state.events.push(mode);
        return chain;
      };
      chain.limit = async () => state.rows.shift() ?? [];
      chain.then = (resolve: (rows: unknown[]) => void) =>
        resolve(state.rows.shift() ?? []);
      return chain;
    },
    insert: () => ({
      values: (value: unknown) => {
        state.inserted.push(value);
        return {
          returning: async () => [{ id: "saved", ...(value as object) }],
        };
      },
    }),
  };
  return {
    ...tables,
    db: { transaction: (fn: (tx: unknown) => unknown) => fn(tx) },
  };
});
vi.mock("../assistant/chatgpt-grant-store", () => ({
  validateAssistantSession: vi.fn(async () => {
    state.events.push("fresh");
    if (state.invalid) throw Error("revoked");
  }),
}));
vi.mock("./queries", () => ({
  resolveChannelAccess: vi.fn(async (_actor, _channel, capability) => {
    state.events.push(capability);
    if (state.denied && capability === "channel.manage")
      throw new WorkHubAccessError("forbidden");
    return {
      channel: { id: "channel", ownerOrgType: "vendor", ownerOrgId: 4 },
    };
  }),
}));
vi.mock("./collaboration-access", () => ({
  assertCollaborationInvite: vi.fn(async () => {
    state.events.push("invite");
  }),
  collaborationChannelScope: vi.fn(async () =>
    state.chat ? { kind: "chat" } : null,
  ),
}));
vi.mock("./audit", () => ({
  appendWorkHubAudit: vi.fn(async () => {
    state.events.push("audit");
  }),
}));
import { WorkHubAccessError } from "./context-access";
import {
  addChannelMember,
  channelMemberInput,
  readChannelMemberAccess,
} from "./channel-members";
import { assertCollaborationInvite } from "./collaboration-access";
const actor = {
  userId: 7,
  role: "vendor",
  vendorId: 4,
  activeMembershipId: 5,
  membershipRole: "admin",
  sv: 1,
} as const;
const reads = (existing: unknown[] = []) => [
  [{ id: 8 }],
  [],
  [],
  [],
  [],
  [],
  [{ id: 8 }],
  existing,
];
describe("existing-channel membership transaction", () => {
  beforeEach(() => {
    state.rows = [];
    state.inserted = [];
    state.events = [];
    state.invalid = false;
    state.denied = false;
    state.chat = false;
    vi.clearAllMocks();
  });
  it("preserves existing owner without another effect or audit", async () => {
    const saved = {
      id: "owner",
      channelId: "channel",
      userId: 8,
      mode: "owner",
    };
    state.rows = reads([saved]);
    expect(
      await addChannelMember(
        actor,
        "channel",
        { email: " OWN@example.invalid " },
        "ios",
      ),
    ).toEqual(saved);
    expect(state.inserted).toEqual([]);
    expect(state.events).not.toContain("audit");
    expect(state.events.slice(0, 6)).toEqual([
      "update",
      "share",
      "update",
      "share",
      "share",
      "fresh",
    ]);
    expect(assertCollaborationInvite).toHaveBeenCalledWith(
      expect.anything(),
      8,
      expect.anything(),
    );
  });
  it("adds and audits only after current session and current management authorization", async () => {
    state.rows = reads();
    expect(
      await addChannelMember(
        actor,
        "channel",
        { email: "new@example.invalid" },
        "ios",
      ),
    ).toMatchObject({ userId: 8, mode: "member" });
    expect(state.inserted).toHaveLength(1);
    expect(state.events.at(-1)).toBe("audit");
    expect(state.events.indexOf("fresh")).toBeLessThan(
      state.events.indexOf("invite"),
    );
  });
  it("denies revoked session and lost management even for an existing member", async () => {
    for (const denial of ["invalid", "denied"] as const) {
      state.rows = reads([{ mode: "owner" }]);
      state[denial] = true;
      await expect(
        addChannelMember(
          actor,
          "channel",
          { email: "own@example.invalid" },
          "ios",
        ),
      ).rejects.toMatchObject({ status: 403 });
      state[denial] = false;
    }
    expect(state.inserted).toEqual([]);
    expect(state.events).not.toContain("audit");
  });
  it("reports no generic-add capability for consent-based chat or ordinary participant", async () => {
    state.chat = true;
    expect(await readChannelMemberAccess(actor, "channel")).toEqual({
      canManage: false,
    });
    state.chat = false;
    state.denied = true;
    expect(await readChannelMemberAccess(actor, "channel")).toEqual({
      canManage: false,
    });
  });
  it("rejects caller authority/operation fields", () => {
    for (const extra of [
      { owner: { type: "vendor", id: 99 } },
      { operationId: "caller" },
      { userId: 99 },
    ])
      expect(
        channelMemberInput.safeParse({ email: "x@example.invalid", ...extra })
          .success,
      ).toBe(false);
  });
});
