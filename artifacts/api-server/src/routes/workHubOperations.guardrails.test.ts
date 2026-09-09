import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const operations = readFileSync(
  resolve(__dirname, "workHubOperations.ts"),
  "utf8",
);
const channels = readFileSync(resolve(__dirname, "workHubChannels.ts"), "utf8");

describe("Work Hub mutation guardrails", () => {
  it("validates every target user against the command owner", () => {
    expect(
      operations.match(/assertOwnerUsers\(/g)?.length,
    ).toBeGreaterThanOrEqual(6);
    expect(operations).toContain("payload.sharedWithUserIds");
  });

  it("atomically closes an open shift before recording its sole claimant", () => {
    expect(operations).toContain("claimOpenShift");
    expect(operations).toMatch(/set\(\{ open: false/);
  });

  it("requires a file command owner to match its authorized channel", () => {
    expect(operations).toContain(
      "assertOwnerMatchesChannel(envelope.owner, channel)",
    );
  });

  it("requires gate supervisors to supply an assigned gate or site context", () => {
    expect(operations).toContain('session.vendorRole === "gate_supervisor"');
    expect(operations).toContain("siteWorkAssignmentsTable.siteLocationId");
  });

  it("enters the idempotency ledger before resolving a deletable channel", () => {
    const deleteRoute = channels.slice(
      channels.indexOf('router.delete("/work-hub/channels/:channelId"'),
      channels.indexOf('router.get("/work-hub/channels/:channelId/members"'),
    );
    expect(deleteRoute.indexOf("executeWorkHubCommand")).toBeLessThan(
      deleteRoute.indexOf("resolveChannelAccess"),
    );
  });
});
