import { expect, it } from "vitest";
import type { PoolClient } from "pg";
import { emptyFleetState } from "./fleet-repository";

it("refuses a driver's configuration write before reading company resources", async () => {
  const module = await import("./fleet-details").catch(() => null);
  expect(module).not.toBeNull();
  const state = { ...emptyFleetState(), enabled: true };
  const service = module!.createFleetDetailsOperations(
    async (_actor, work) => work(state, {} as PoolClient),
    () => ({ fleetIds: [], roles: ["driver"] }),
  );
  await expect(
    service.saveFleetRigPackage({ userId: 42, companyId: 7 }, {}),
  ).rejects.toMatchObject({ code: "fleet.dispatch_required", status: 403 });
});
