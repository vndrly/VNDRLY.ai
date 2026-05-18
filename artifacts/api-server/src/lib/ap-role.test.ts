import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Coverage for Task #497 — userHasApRole helper.
//
// We only assert that the helper executes the right SQL shape and trusts
// the boolean Postgres returns. Two real Postgres scenarios are covered
// end-to-end by the route test (route_disperse-funds).

const executeMock = vi.fn(async (..._args: unknown[]) => ({
  rows: [{ has_role: false }],
}));

vi.mock("@workspace/db", () => ({
  db: { execute: executeMock },
}));

beforeEach(() => {
  executeMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("userHasApRole", () => {
  it("returns true when the SQL returns has_role=true", async () => {
    executeMock.mockResolvedValueOnce({ rows: [{ has_role: true }] } as any);
    const { userHasApRole } = await import("./ap-role");
    const got = await userHasApRole(42, 7);
    expect(got).toBe(true);
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it("returns false when the SQL returns has_role=false", async () => {
    executeMock.mockResolvedValueOnce({ rows: [{ has_role: false }] } as any);
    const { userHasApRole } = await import("./ap-role");
    const got = await userHasApRole(42, 7);
    expect(got).toBe(false);
  });

  it("returns false when the SQL returns no rows", async () => {
    executeMock.mockResolvedValueOnce({ rows: [] } as any);
    const { userHasApRole } = await import("./ap-role");
    const got = await userHasApRole(42, 7);
    expect(got).toBe(false);
  });

  it("matches the Accounts Payable role string and the partner_contacts join shape", async () => {
    executeMock.mockResolvedValueOnce({ rows: [{ has_role: true }] } as any);
    const { userHasApRole, ACCOUNTS_PAYABLE_ROLE } = await import("./ap-role");
    expect(ACCOUNTS_PAYABLE_ROLE).toBe("Accounts Payable");
    await userHasApRole(11, 22);

    // Inspect the rendered SQL fragment that was passed in.
    const call = executeMock.mock.calls[0]![0] as any;
    const queryStr = JSON.stringify(call);
    // Org-admin branch.
    expect(queryStr).toContain("user_org_memberships");
    expect(queryStr).toContain("admin");
    // AP partner_contacts branch.
    expect(queryStr).toContain("partner_contacts");
    expect(queryStr).toContain("Accounts Payable");
    expect(queryStr).toContain("ANY(pc.roles)");
    // Email join must be case-insensitive on both sides.
    expect(queryStr).toContain("lower(pc.email)");
    expect(queryStr).toContain("lower(u.username)");
  });
});
