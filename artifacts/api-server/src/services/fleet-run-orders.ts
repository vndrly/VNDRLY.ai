import { createHash, randomUUID } from "node:crypto";
import { z } from "zod/v4";
import {
  FleetCanonicalIdSchema,
  FleetRunOrderSchema,
  FleetRunOrderSaveSchema,
  FleetRunOrderReceiptSchema,
  FleetRunOrderLocationsSchema,
  FleetCommercialSettingsSchema,
  fleetRunOrderRoute,
  type FleetRunOrder,
} from "@workspace/api-zod";
import type { PoolClient } from "pg";
import type { FleetActor } from "./fleet-ops";
import { FleetError, type FleetState } from "./fleet-repository";
import {
  appendFleetResourceRecord,
  readFleetResourceRecord,
} from "./fleet-resource-store";
import { assertFleetRouteLocations } from "./fleet-commercial";
import { readFleetAuthoritySites } from "./fleet-commercial-authority";

type Transaction = <T>(
  actor: FleetActor,
  work: (state: FleetState, client: PoolClient) => Promise<T>,
) => Promise<T>;
type Access = (
  state: FleetState,
  actor: FleetActor,
) => { roles: readonly string[]; fleetIds: readonly string[] } | null;
const page = z
  .object({
    after: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(50),
  })
  .strict();
const target = "fleet-run-order",
  operationTarget = "fleet-run-order-operation";

/** Definitions use existing immutable audit storage and the existing vendor
 * transaction lock. Saving an order never creates/reserves a Detail or ticket. */
export function createFleetRunOrderOperations(
  transaction: Transaction,
  access: Access,
) {
  function scope(state: FleetState, actor: FleetActor, write = false) {
    const grant = access(state, actor);
    if (
      !state.enabled ||
      !grant?.roles.some((role) =>
        (write?["fleet_manager", "dispatcher"]:["fleet_manager","dispatcher","driver"]).includes(role),
      ) ||
      (write && actor.readOnly)
    )
      throw new FleetError("fleet.dispatch_required", 403);
    return grant;
  }
  function check(
    order: FleetRunOrder,
    actor: FleetActor,
    grant: NonNullable<ReturnType<Access>>,
  ) {
    if (
      order.companyId !== actor.companyId ||
      !order.accessGroupIds.some((id) => grant.fleetIds.includes(id))
    )
      throw new FleetError("fleet.run_order_not_found", 404);
  }
  async function read(client: PoolClient, actor: FleetActor, id: string) {
    const raw = await readFleetResourceRecord(
      client,
      actor.companyId,
      target,
      FleetCanonicalIdSchema.parse(id),
    );
    if (!raw) throw new FleetError("fleet.run_order_not_found", 404);
    return FleetRunOrderSchema.parse(raw);
  }
  async function ownerAccess(
    state: FleetState,
    client: PoolClient,
    actor: FleetActor,
    order: FleetRunOrder,
  ) {
    const partners = [
      order.origin,
      order.destination,
      ...(order.base ? [order.base] : []),
    ].filter((location) => location.ownerType === "partner");
    if (
      [
        order.origin,
        order.destination,
        ...(order.base ? [order.base] : []),
      ].some(
        (location) =>
          location.ownerType === "vendor" &&
          location.ownerId !== actor.companyId,
      )
    )
      throw new FleetError("fleet.run_order_not_found", 404);
    if (partners.length) {
      const sites = await readFleetAuthoritySites(client, actor.companyId, {
        siteIds: (
          state.grants.find((grant) => grant.userId === actor.userId)
            ?.siteIds ?? []
        ).filter((id) => actor.currentSiteIds?.includes(id)),
      });
      if (
        partners.some(
          (location) =>
            !sites.some((site) => site.partner_id === location.ownerId),
        )
      )
        throw new FleetError("fleet.run_order_not_found", 404);
    }
  }
  async function permittedRecord(
    state: FleetState,
    client: PoolClient,
    actor: FleetActor,
    order: FleetRunOrder,
  ) {
    const grant = scope(state, actor);
    check(order, actor, grant);
    await ownerAccess(state, client, actor, order);
  }
  async function receipt(
    client: PoolClient,
    actor: FleetActor,
    operationId: string,
  ) {
    const rows = await client.query(
      "SELECT user_id,tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type=$2 AND target_id=$3 ORDER BY id DESC LIMIT 1",
      [
        actor.companyId,
        operationTarget,
        FleetCanonicalIdSchema.parse(operationId),
      ],
    );
    if (!rows.rows.length) return null;
    if (rows.rows[0].user_id !== actor.userId)
      throw new FleetError("fleet.operation_conflict");
    return FleetRunOrderReceiptSchema.parse(rows.rows[0].tool_output);
  }
  return {
    fleetRunOrderLocations: (actor: FleetActor, id: string) =>
      transaction(actor, async (state, client) => {
        const order = await read(client, actor, id);
        await permittedRecord(state, client, actor, order);
        const saved = [
          ...new Map(
            [
              order.origin,
              order.destination,
              ...(order.base ? [order.base] : []),
            ].map((place) => [place.id, place]),
          ).values(),
        ];
        const owners = new Map<
          string,
          ReturnType<typeof FleetCommercialSettingsSchema.parse>["destinations"]
        >();
        const locations: typeof saved = [],
          unavailableLocationIds: string[] = [];
        for (const place of saved) {
          const key = `${place.ownerType}:${place.ownerId}`;
          if (!owners.has(key)) {
            const table = place.ownerType === "vendor" ? "vendors" : "partners";
            const row = (
              await client.query(
                `SELECT fleet_commercial_settings FROM ${table} WHERE id=$1 FOR SHARE`,
                [place.ownerId],
              )
            ).rows[0];
            owners.set(
              key,
              FleetCommercialSettingsSchema.parse(
                row?.fleet_commercial_settings ?? {},
              ).destinations,
            );
          }
          const current = owners
            .get(key)!
            .find(
              (item) =>
                item.id === place.id &&
                item.ownerType === place.ownerType &&
                item.ownerId === place.ownerId,
            );
          if (
            !current?.active ||
            (current.permittedCompanyIds?.length &&
              !current.permittedCompanyIds.includes(actor.companyId)) ||
            (current.activeFrom &&
              Date.parse(current.activeFrom) > Date.now()) ||
            (current.activeUntil &&
              Date.parse(current.activeUntil) <= Date.now())
          )
            unavailableLocationIds.push(place.id);
          else locations.push(current);
        }
        return FleetRunOrderLocationsSchema.parse({
          orderId: order.id,
          orderVersion: order.version,
          locations,
          unavailableLocationIds,
        });
      }),
    saveFleetRunOrder: (actor: FleetActor, raw: unknown) =>
      transaction(actor, async (state, client) => {
        const grant = scope(state, actor, true),
          body = FleetRunOrderSaveSchema.parse(raw),
          order = body.order;
        check(order, actor, grant);
        if (
          !order.accessGroupIds.every(
            (id) =>
              grant.fleetIds.includes(id) &&
              state.fleets.some((group) => group.id === id),
          )
        )
          throw new FleetError("fleet.fleet_forbidden", 403);
        const fingerprint = createHash("sha256")
          .update(JSON.stringify([actor.companyId, actor.userId, body]))
          .digest("hex");
        const priorReceipt = await receipt(client, actor, body.operationId);
        const currentRaw = await readFleetResourceRecord(
          client,
          actor.companyId,
          target,
          order.id,
        );
        const current = currentRaw
          ? FleetRunOrderSchema.parse(currentRaw)
          : null;
        if (current) await permittedRecord(state, client, actor, current);
        if (priorReceipt) {
          if (priorReceipt.fingerprint !== fingerprint)
            throw new FleetError("fleet.operation_conflict");
          await permittedRecord(state, client, actor, priorReceipt.order);
          return priorReceipt.order;
        }
        if (
          (current?.version ?? 0) !== body.expectedVersion ||
          order.version !== body.expectedVersion + 1
        )
          throw new FleetError("fleet.version_conflict");
        await ownerAccess(state, client, actor, order);
        if (order.archivedAt) {
          if (!current) throw new FleetError("fleet.run_order_not_found", 404);
          const {
            archivedAt: _oldArchived,
            version: _oldVersion,
            ...oldDefinition
          } = current;
          const {
            archivedAt: _newArchived,
            version: _newVersion,
            ...newDefinition
          } = order;
          if (JSON.stringify(oldDefinition) !== JSON.stringify(newDefinition))
            throw new FleetError("fleet.run_order_archive_changed", 409);
        } else
          await assertFleetRouteLocations(
            client,
            actor,
            state,
            fleetRunOrderRoute(order, randomUUID),
            true,
          );
        await appendFleetResourceRecord(client, actor, target, order.id, order);
        await appendFleetResourceRecord(
          client,
          actor,
          operationTarget,
          body.operationId,
          { operationId: body.operationId, fingerprint, order },
        );
        return order;
      }),
    fleetRunOrder: (actor: FleetActor, id: string) =>
      transaction(actor, async (state, client) => {
        scope(state, actor);
        const order = await read(client, actor, id);
        await permittedRecord(state, client, actor, order);
        return order;
      }),
    readFleetRunOrders: (actor: FleetActor, raw: unknown = {}) =>
      transaction(actor, async (state, client) => {
        const grant = scope(state, actor),
          query = page.parse(raw);
        // Filter current revisions before pagination. No active-array capacity cap
        // and no fetching another company's transport orders into the application.
        const rows = await client.query(
          "SELECT id,tool_output FROM (SELECT DISTINCT ON(target_id) id,tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type=$2 ORDER BY target_id,id DESC) latest WHERE ($3::int IS NULL OR id<$3) AND tool_output->>'archivedAt' IS NULL AND (tool_output->'accessGroupIds') ?| $4::text[] ORDER BY id DESC LIMIT $5",
          [
            actor.companyId,
            target,
            query.after ?? null,
            [...grant.fleetIds],
            query.limit + 1,
          ],
        );
        const orders: FleetRunOrder[] = [];
        for (const row of rows.rows.slice(0, query.limit)) {
          const order = FleetRunOrderSchema.parse(row.tool_output);
          check(order, actor, grant);
          try {
            await ownerAccess(state, client, actor, order);
            orders.push(order);
          } catch (error) {
            if (
              !(error instanceof FleetError) ||
              error.code !== "fleet.run_order_not_found"
            )
              throw error;
          }
        }
        return {
          orders,
          nextCursor:
            rows.rows.length > query.limit
              ? Number(rows.rows[query.limit - 1].id)
              : null,
          canManage: !actor.readOnly,
        };
      }),
    fleetRunOrderReceipt: (actor: FleetActor, id: string) =>
      transaction(actor, async (state, client) => {
        scope(state, actor);
        const found = await receipt(client, actor, id);
        if (!found) throw new FleetError("fleet.operation_not_found", 404);
        await permittedRecord(
          state,
          client,
          actor,
          await read(client, actor, found.order.id),
        );
        await permittedRecord(state, client, actor, found.order);
        return found;
      }),
    fleetRunOrderHistory: (actor: FleetActor, id: string, raw: unknown = {}) =>
      transaction(actor, async (state, client) => {
        scope(state, actor);
        const query = page.parse(raw),
          current = await read(client, actor, id);
        await permittedRecord(state, client, actor, current);
        const rows = await client.query(
          "SELECT id,tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type=$2 AND target_id=$3 AND ($4::int IS NULL OR id<$4) ORDER BY id DESC LIMIT $5",
          [
            actor.companyId,
            target,
            current.id,
            query.after ?? null,
            query.limit + 1,
          ],
        );
        const records = [];
        for (const row of rows.rows.slice(0, query.limit)) {
          const order = FleetRunOrderSchema.parse(row.tool_output);
          await permittedRecord(state, client, actor, order);
          records.push({ id: Number(row.id), order });
        }
        return {
          records,
          nextCursor:
            rows.rows.length > query.limit
              ? Number(rows.rows[query.limit - 1].id)
              : null,
        };
      }),
  };
}
