// Branding seed idempotency runs in its own database: before/after ID
// snapshots cannot distinguish this seed's rows from another suite's fixtures.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIsolatedSchema, hasReachableDatabase, type IsolatedSchemaHandle } from "../test/db-harness";

const haveRealDb = await hasReachableDatabase();

describe.runIf(haveRealDb)("seed-partner-branding idempotency", () => {
  let s: typeof import("@workspace/db");
  let seedPartnerBranding: typeof import("../../scripts/seed-partner-branding.js").seedPartnerBranding;
  let seedPartners: typeof import("../../scripts/seed-permian-basin.js").seedPartners;
  let handle: IsolatedSchemaHandle | null = null;

  beforeAll(async () => {
    handle = await createIsolatedSchema("partner_branding_seed");
    handle.activate();
    s = await import("@workspace/db");
    seedPartnerBranding = (await import("../../scripts/seed-partner-branding.js")).seedPartnerBranding;
    seedPartners = (await import("../../scripts/seed-permian-basin.js")).seedPartners;
  });

  afterAll(async () => {
    try {
      await s?.pool.end();
    } finally {
      await handle?.teardown();
    }
  });

  it("re-running the seed makes no changes (no logos filled, no colors filled, no errors)", async () => {
    await seedPartners();
    await seedPartnerBranding();
    const secondRun = await seedPartnerBranding();
    expect(secondRun.logoFilled).toBe(0);
    expect(secondRun.colorsFilled).toBe(0);
    expect(secondRun.notFound).toEqual([]);
  }, 120_000);
});
