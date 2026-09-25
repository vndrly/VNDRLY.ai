import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { assetCursorCondition, channelSearchContext, channelSearchContexts, decodeAssetCursor, encodeAssetCursor, searchCappedSources } from "./workHubSearchPolicy";

const vendorSession = { userId: 17, role: "vendor", vendorId: 4, partnerId: null, membershipRole: "admin" };

describe("Work Hub search boundaries", () => {
  it("uses a current partner membership across a stale vendor cookie and rejects a revoked owner", () => {
    const channel = { ownerOrgType: "partner", ownerOrgId: 8 };
    const current = [{ orgType: "partner", partnerId: 8, vendorId: null, role: "member" }];
    expect(channelSearchContext(vendorSession, channel, current, false, false)).toMatchObject({ vendorId: null, partnerId: 8, membershipRole: "member" });
    expect(channelSearchContext(vendorSession, channel, [], false, false)).toBeNull();
  });

  it("keeps a current explicit shared invitation after owner membership is removed", () => {
    expect(channelSearchContext(vendorSession, { ownerOrgType: "partner", ownerOrgId: 8 }, [], false, true)).toBe(vendorSession);
  });

  it("uses full member access when a managed worker also has current partner membership", () => {
    const worker = { ...vendorSession, managedSubcontractor: { siteGrants: [] } };
    const current = [{ orgType: "partner", partnerId: 8, vendorId: null, role: "member" }];
    expect(channelSearchContext(worker, { ownerOrgType: "partner", ownerOrgId: 8 }, current, false, false))
      .toMatchObject({ partnerId: 8, managedSubcontractor: undefined });
  });

  it("retains an explicit shared invitation for a managed worker outside the sponsor", () => {
    const worker = { ...vendorSession, managedSubcontractor: { siteGrants: [] } };
    expect(channelSearchContext(worker, { ownerOrgType: "partner", ownerOrgId: 8 }, [], false, true))
      .toMatchObject({ managedSubcontractor: undefined });
  });

  it("uses a current partner-site or ticket membership for a vendor-owned channel, then fails closed on revocation", () => {
    const channel = { ownerOrgType: "vendor", ownerOrgId: 10 };
    const partner = { orgType: "partner", partnerId: 8, vendorId: null, role: "member" };
    const relationship = [{ ownerOrgType: "partner", ownerOrgId: 8 }];
    expect(channelSearchContexts(vendorSession, channel, [partner], false, false, relationship))
      .toEqual([expect.objectContaining({ vendorId: null, partnerId: 8, membershipRole: "member" })]);
    expect(channelSearchContexts(vendorSession, channel, [], false, false, relationship)).toEqual([]);
    expect(channelSearchContexts(vendorSession, channel, [], false, true, relationship)).toEqual([vendorSession]);
  });

  it("preserves six-digit PostgreSQL precision in the inventory cursor and SQL bound parameter", () => {
    const token = encodeAssetCursor({ updatedAt: "2026-09-24T12:30:40.123456Z", id: "00000000-0000-4000-8000-000000000001" });
    const decoded = decodeAssetCursor(token);
    expect(decoded.updatedAt).toBe("2026-09-24T12:30:40.123456Z");
    const query = new PgDialect().sqlToQuery(assetCursorCondition(decoded));
    expect(query.params).toContain("2026-09-24T12:30:40.123456Z");
    expect(query.sql).toContain("timestamptz");
  });

  it("reports an upstream channel cap for filtered channel-linked sources", () => {
    for (const type of ["message", "note", "file", "announcement"]) {
      expect(searchCappedSources({ types: [type], channelCount: 500, sourceCounts: {}, combinedCount: 0 })).toContain("channel");
    }
    expect(searchCappedSources({ types: ["task"], channelCount: 500, sourceCounts: {}, combinedCount: 0 })).not.toContain("channel");
    expect(searchCappedSources({ types: ["meeting"], channelCount: 0, sourceCounts: { transcript: 500 }, combinedCount: 0 })).toContain("transcript");
  });
});
