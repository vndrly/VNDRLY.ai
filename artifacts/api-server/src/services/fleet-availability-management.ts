import { createHash, randomUUID } from "node:crypto";
import {
  FleetAvailabilityInputSchema,
  FleetAvailabilityReadSchema,
  FleetAvailabilityReceiptSchema,
  type FleetRun,
} from "@workspace/api-zod";
import { fleetAvailabilityFingerprintValues } from "@workspace/api-zod";
import type { PoolClient } from "pg";
import type { FleetActor } from "./fleet-ops";
import { FleetError, type FleetState } from "./fleet-repository";

type Transaction = <T>(
  actor: FleetActor,
  operation: (state: FleetState, client: PoolClient) => Promise<T>,
) => Promise<T>;
function access(
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
async function records(
  client: PoolClient,
  companyId: number,
  driverUserId: number,
) {
  const person = await client.query(
    "SELECT vp.id FROM vendor_people vp JOIN users u ON u.id=vp.user_id JOIN user_org_memberships m ON m.user_id=u.id AND m.vendor_id=vp.vendor_id AND m.org_type='vendor' WHERE vp.vendor_id=$1 AND vp.user_id=$2 AND vp.is_active=true AND vp.deleted_at IS NULL AND u.suspended_at IS NULL FOR SHARE OF vp,m",
    [companyId, driverUserId],
  );
  if (!person.rows.length)
    throw new FleetError("fleet.driver_unavailable", 403);
  const result = await client.query(
    "SELECT id,starts_at,ends_at,available,recurrence FROM work_hub_availability WHERE owner_org_type='vendor' AND owner_org_id=$1 AND user_id=$2 ORDER BY id LIMIT 101 FOR UPDATE",
    [companyId, driverUserId],
  );
  if (result.rows.length > 100)
    throw new FleetError("fleet.availability_capacity_reached");
  const rows = result.rows.map((row) => ({
    id: row.id,
    startsAt: new Date(row.starts_at).toISOString(),
    endsAt: new Date(row.ends_at).toISOString(),
    available: row.available,
    recurring: row.recurrence != null,
  }));
  return {
    rows,
    fingerprint: createHash("sha256")
      .update(JSON.stringify(rows))
      .digest("hex"),
  };
}
export function createFleetAvailabilityManagement(transaction: Transaction) {
  return {
    driverAvailability: (actor: FleetActor, driverUserId: number) => {
      const bound = { ...actor, schedulingDriverUserIds: [driverUserId] };
      return transaction(bound, async (state, client) => {
        const canManage = access(state, bound, driverUserId, false),
          current = await records(client, actor.companyId, driverUserId);
        return FleetAvailabilityReadSchema.parse({
          driverUserId,
          fingerprint: current.fingerprint,
          records: current.rows,
          canManage,
          physicalReadinessVerified: false,
        });
      });
    },
    recordDriverAvailability: (actor: FleetActor, input: unknown) => {
      const body = FleetAvailabilityInputSchema.parse(input);
      const bound = { ...actor, schedulingDriverUserIds: [body.driverUserId] };
      return transaction(bound, async (state, client) => {
        access(state, bound, body.driverUserId, true);
        const current = await records(
          client,
          actor.companyId,
          body.driverUserId,
        );
        const commandFingerprint = createHash("sha256")
          .update(
            JSON.stringify(
              fleetAvailabilityFingerprintValues(
                actor.userId,
                actor.companyId,
                body,
              ),
            ),
          )
          .digest("hex");
        const prior = await client.query(
          "SELECT tool_output FROM assistant_action_audit WHERE target_type='fleet-availability-operation' AND target_id=$1 AND vendor_id=$2 LIMIT 2",
          [body.operationId, actor.companyId],
        );
        if (prior.rows.length) {
          if (prior.rows.length !== 1)
            throw new FleetError("fleet.operation_conflict");
          const receipt = FleetAvailabilityReceiptSchema.parse(
            prior.rows[0].tool_output,
          );
          if (
            receipt.actorUserId !== actor.userId ||
            receipt.driverUserId !== body.driverUserId ||
            receipt.commandFingerprint !== commandFingerprint
          )
            throw new FleetError("fleet.operation_conflict");
          return receipt;
        }
        if (current.fingerprint !== body.expectedFingerprint)
          throw new FleetError("fleet.version_conflict");
        const previous = body.recordId
          ? current.rows.find((row) => row.id === body.recordId)
          : undefined;
        if (body.recordId && (!previous || previous.recurring))
          throw new FleetError("fleet.availability_record_conflict");
        const start = Date.parse(body.window.plannedStartAt),
          end = Date.parse(body.window.plannedEndAt);
        if (
          current.rows.some(
            (row) =>
              row.id !== body.recordId &&
              Date.parse(row.startsAt) < end &&
              Date.parse(row.endsAt) > start,
          )
        )
          throw new FleetError("fleet.availability_record_conflict");
        // Replacing evidence cannot invalidate an already dispatched scheduled run.
        const committed = state.runs.filter(
          (run) =>
            run.driverUserId === body.driverUserId &&
            ["dispatched", "acknowledged", "in_progress"].includes(
              run.status,
            ) &&
            run.schedule,
        );
        const nextRows = current.rows.filter((row) => row.id !== body.recordId);
        const record = {
          id: body.recordId ?? randomUUID(),
          startsAt: new Date(start).toISOString(),
          endsAt: new Date(end).toISOString(),
          available: body.available,
          recurring: false,
        };
        nextRows.push(record);
        if (
          committed.some((run: FleetRun) => {
            const a = Date.parse(run.schedule!.plannedStartAt),
              b = Date.parse(run.schedule!.plannedEndAt);
            return (
              !nextRows.some(
                (row) =>
                  row.available &&
                  !row.recurring &&
                  Date.parse(row.startsAt) <= a &&
                  Date.parse(row.endsAt) >= b,
              ) ||
              nextRows.some(
                (row) =>
                  !row.available &&
                  Date.parse(row.startsAt) < b &&
                  Date.parse(row.endsAt) > a,
              )
            );
          })
        )
          throw new FleetError("fleet.driver_schedule_conflict");
        // The complete driver user lock is already held. Gate writers use that
        // same prerequisite, so their assignment/availability check cannot race
        // this replacement. Ordinary WorkHub shifts retain their existing policy.
        const gate = await client.query(
          "SELECT s.starts_at,s.ends_at FROM work_hub_shift_assignments a JOIN work_hub_shifts s ON s.id=a.shift_id JOIN site_locations site ON site.id=s.site_location_id WHERE a.user_id=$1 AND s.owner_org_type='vendor' AND s.owner_org_id=$2 AND s.gate_station_id IS NOT NULL AND a.status NOT IN ('cancelled','declined') AND s.milestone_status<>'cancelled' AND EXISTS(SELECT 1 FROM site_work_assignments swa JOIN partner_vendor_relationships r ON r.vendor_id=swa.vendor_id AND r.partner_id=site.partner_id WHERE swa.vendor_id=$2 AND swa.site_location_id=site.id AND swa.is_gate_contractor=true AND r.status='approved') ORDER BY s.id LIMIT 101 FOR SHARE OF s,a",
          [body.driverUserId, actor.companyId],
        );
        if (gate.rows.length > 100)
          throw new FleetError("fleet.availability_capacity_reached");
        const covers = (rows: typeof nextRows, a: number, b: number) =>
          rows.some(
            (row) =>
              row.available &&
              !row.recurring &&
              Date.parse(row.startsAt) <= a &&
              Date.parse(row.endsAt) >= b,
          ) &&
          !rows.some(
            (row) =>
              !row.available &&
              Date.parse(row.startsAt) < b &&
              Date.parse(row.endsAt) > a,
          );
        if (
          gate.rows.some((row) => {
            const a = new Date(row.starts_at).getTime(),
              b = new Date(row.ends_at).getTime();
            return covers(current.rows, a, b) && !covers(nextRows, a, b);
          })
        )
          throw new FleetError("fleet.driver_schedule_conflict");
        if (body.recordId)
          await client.query(
            "UPDATE work_hub_availability SET starts_at=$4,ends_at=$5,available=$6 WHERE id=$1 AND owner_org_type='vendor' AND owner_org_id=$2 AND user_id=$3",
            [
              record.id,
              actor.companyId,
              body.driverUserId,
              record.startsAt,
              record.endsAt,
              record.available,
            ],
          );
        else {
          if (current.rows.length >= 100)
            throw new FleetError("fleet.availability_capacity_reached");
          await client.query(
            "INSERT INTO work_hub_availability(id,owner_org_type,owner_org_id,user_id,starts_at,ends_at,available) VALUES($1,'vendor',$2,$3,$4,$5,$6)",
            [
              record.id,
              actor.companyId,
              body.driverUserId,
              record.startsAt,
              record.endsAt,
              record.available,
            ],
          );
        }
        const after = await records(client, actor.companyId, body.driverUserId);
        const receipt = FleetAvailabilityReceiptSchema.parse({
          operationId: body.operationId,
          actorUserId: actor.userId,
          companyId: actor.companyId,
          driverUserId: body.driverUserId,
          commandFingerprint,
          previousFingerprint: current.fingerprint,
          resultingFingerprint: after.fingerprint,
          record,
          recordedAt: new Date().toISOString(),
          physicalReadinessVerified: false,
        });
        await client.query(
          "INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) VALUES($1,$2,'fleet','typed','canonical','fleet_availability','availability-recorded','fleet-availability-operation',$3,$4::jsonb,'completed')",
          [
            actor.userId,
            actor.companyId,
            body.operationId,
            JSON.stringify(receipt),
          ],
        );
        return receipt;
      });
    },
    driverAvailabilityOperation: (
      actor: FleetActor,
      driverUserId: number,
      operationId: string,
    ) => {
      const bound = { ...actor, schedulingDriverUserIds: [driverUserId] };
      return transaction(bound, async (state, client) => {
        access(state, bound, driverUserId, true);
        await records(client, actor.companyId, driverUserId);
        const prior = await client.query(
          "SELECT tool_output FROM assistant_action_audit WHERE target_type='fleet-availability-operation' AND target_id=$1 AND vendor_id=$2 AND user_id=$3 LIMIT 2",
          [operationId, actor.companyId, actor.userId],
        );
        if (!prior.rows.length) return { receipt: null };
        if (prior.rows.length !== 1)
          throw new FleetError("fleet.operation_conflict");
        const receipt = FleetAvailabilityReceiptSchema.parse(
          prior.rows[0].tool_output,
        );
        if (
          receipt.actorUserId !== actor.userId ||
          receipt.companyId !== actor.companyId ||
          receipt.driverUserId !== driverUserId ||
          receipt.operationId !== operationId
        )
          throw new FleetError("fleet.operation_conflict");
        return { receipt };
      });
    },
  };
}
