import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { capabilityFlagsTable } from "../../../../lib/db/src/schema/capabilityFlags";

describe("Implementation A capability flags schema", () => {
  it("stores owner and optional site scoped rollout state", () => {
    expect(getTableName(capabilityFlagsTable)).toBe("capability_flags");
    expect(capabilityFlagsTable.ownerOrgType).toBeDefined();
    expect(capabilityFlagsTable.ownerOrgId).toBeDefined();
    expect(capabilityFlagsTable.siteId).toBeDefined();
    expect(capabilityFlagsTable.flagName).toBeDefined();
    expect(capabilityFlagsTable.enabled).toBeDefined();
  });
});
