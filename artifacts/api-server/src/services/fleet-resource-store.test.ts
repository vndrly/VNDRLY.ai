import { expect, it, vi } from "vitest";
import { readFleetResourceAssets } from "./fleet-resource-store";
import { emptyFleetState } from "./fleet-repository";
import type { PoolClient } from "pg";
it("uses a shared asset lock for historical snapshot labels rather than an exclusive reservation lock", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const query = vi.fn(async (_sql: string, _params: unknown[]) => ({
    rows: [{ id, responsible_org_type: "vendor", responsible_org_id: 7 }],
  }));
  await readFleetResourceAssets(
    { query } as unknown as PoolClient,
    { userId: 1, companyId: 7 },
    emptyFleetState(),
    [id],
    true,
  );
  expect(query.mock.calls[0][0]).toContain("FOR SHARE OF a");
  expect(query.mock.calls[0][0]).not.toContain("FOR UPDATE");
});
