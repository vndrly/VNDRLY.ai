import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./governance-retention-runtime.ts", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");

describe("governance retention runtime safety boundary", () => {
  it("contains no governed-content deletion or object deletion path", () => {
    expect(source).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(source).not.toContain("deleteObject");
    expect(source).not.toContain(".delete(");
  });

  it("uses current database authorization inside every owner mutation transaction", () => {
    expect(
      source.match(
        /\(tx\) => authorizeOwnerAdmin\(input\.actorUserId, input\.owner, tx\)/g,
      ),
    ).toHaveLength(3);
  });

  it("never copies a hold reason into audit metadata", () => {
    expect(source).not.toMatch(/metadata:\s*\{[^}]*reason/s);
    expect(source).not.toMatch(/metadata:\s*input\.reason/);
  });

  it("owner-validates a meeting channel ancestor and fails closed on drift", () => {
    expect(source).toContain(".leftJoin(\n      workHubChannelsTable");
    expect(source).toContain(
      "eq(workHubChannelsTable.ownerOrgType, owner.type)",
    );
    expect(source).toContain("eq(workHubChannelsTable.ownerOrgId, owner.id)");
    expect(source).toContain(
      "occurrence.channelId && !occurrence.matchedChannelId",
    );
  });

  it("verifies polymorphic owner existence before the platform-admin early return", () => {
    const existence = source.indexOf("async function ownerExists");
    const authorization = source.indexOf("async function authorizeOwnerAdmin");
    const adminReturn = source.indexOf(
      'if (user.role === "admin") return;',
      authorization,
    );
    const existenceCall = source.indexOf(
      "await ownerExists(owner, executor)",
      authorization,
    );
    expect(existence).toBeGreaterThan(-1);
    expect(existenceCall).toBeGreaterThan(authorization);
    expect(existenceCall).toBeLessThan(adminReturn);
  });
});
