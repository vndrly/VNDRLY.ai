import { describe, expect, it, vi, beforeEach } from "vitest";
const state = vi.hoisted(() => ({ results: [] as unknown[][] }));
vi.mock("@workspace/db", async importOriginal => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, db: { select: () => {
    const chain: Record<string, unknown> = {};
    for (const name of ["from", "where"]) chain[name] = () => chain;
    chain.limit = async () => state.results.shift() ?? [];
    return chain;
  } } };
});
import { collaborationChannelScope, assertCollaborationInvite } from "./collaboration-access";

describe("collaboration access database boundaries", () => {
  beforeEach(() => { state.results = []; });
  it("preserves legacy channel behavior", async () => {
    state.results = [[]];
    expect(await collaborationChannelScope(7, "legacy")).toBeNull();
  });
  it("denies private-channel read to a Crew owner who was not invited", async () => {
    state.results = [[{ kind: "private", crewId: "crew" }], [], [{ mode: "owner" }], [{ ownerOrgType: "vendor", ownerOrgId: 1 }], [{ userId: 7 }]];
    expect(await collaborationChannelScope(7, "private")).toMatchObject({ readable: false, manager: false });
  });
  it("allows Crew owners to manage Crew-wide channels", async () => {
    state.results = [[{ kind: "crew", crewId: "crew" }], [], [{ mode: "owner" }], [{ ownerOrgType: "vendor", ownerOrgId: 1 }], [{ userId: 7 }]];
    expect(await collaborationChannelScope(7, "public")).toMatchObject({ readable: true, manager: true });
  });
  it("revokes Crew access after the company membership is removed", async () => {
    state.results = [[{ kind: "crew", crewId: "crew" }], [{ mode: "owner" }], [{ mode: "owner" }], [{ ownerOrgType: "vendor", ownerOrgId: 1 }], []];
    expect(await collaborationChannelScope(7, "former-company")).toMatchObject({ readable: false, manager: false });
  });
  it("denies private chat additions through the generic membership API", async () => {
    state.results = [[{ kind: "chat", crewId: null }], []];
    await expect(assertCollaborationInvite({ id: "chat", ownerOrgType: "vendor", ownerOrgId: 1 }, 8)).rejects.toThrow("forbidden");
  });
  it("denies cross-company membership without explicit invitation consent", async () => {
    state.results = [[{ kind: "shared", crewId: null }], [], []];
    await expect(assertCollaborationInvite({ id: "shared", ownerOrgType: "vendor", ownerOrgId: 1 }, 8)).rejects.toThrow("forbidden");
  });
});

