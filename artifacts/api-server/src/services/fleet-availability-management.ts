import { FleetAvailabilityReceiptSchema } from '@workspace/api-zod';
import { FleetError, type FleetState } from './fleet-repository';
import type { FleetActor } from './fleet-ops';
import { createAvailabilityManagementCore, type AvailabilityTransaction } from './work-hub-availability-core';
function fleetAccess(
  state: FleetState,
  actor: FleetActor,
  driverUserId: number,
  manage: boolean,
) {
  const currentSites = actor.currentSiteIds ?? [];
  const current = state.grants.find((grant) => grant.userId === actor.userId);
  const driver = state.grants.find((grant) => grant.userId === driverUserId);
  const manager =
    current?.roles.some(
      (role) => role === "fleet_manager" || role === "dispatcher",
    ) === true;
  const sharedFleet =
    driver?.roles.includes("driver") &&
    driver.fleetIds.some(
      (id) =>
        current?.fleetIds.includes(id) &&
        state.fleets.some(
          (fleet) =>
            fleet.id === id &&
            fleet.siteIds.some(
              (site) =>
                currentSites.includes(site) &&
                current.siteIds.includes(site) &&
                driver.siteIds.includes(site),
            ),
        ),
    );
  if (
    !state.enabled ||
    !sharedFleet ||
    (manage ? !manager : !manager && actor.userId !== driverUserId)
  )
    throw new FleetError("fleet.dispatch_required", 403);
  return manager;
}

export function createFleetAvailabilityManagement(transaction: AvailabilityTransaction) {
 return createAvailabilityManagementCore(transaction, { access: fleetAccess, operationTarget: 'fleet-availability-operation', receiptSchema: FleetAvailabilityReceiptSchema });
}
