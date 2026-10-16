import { createHash } from "node:crypto";
import { z } from "zod/v4";
import {
  FleetDetailSchema,
  FleetDetailSnapshotSchema,
  FleetRigPackageSchema,
  FleetResourceReceiptSchema,
  FleetCanonicalIdSchema,
  type FleetDetail,
  type FleetDetailSnapshot,
  type FleetRigPackage,
} from "@workspace/api-zod";
import type { PoolClient } from "pg";
import type { FleetActor } from "./fleet-ops";
import { FleetError, type FleetState } from "./fleet-repository";
import {
  appendFleetResourceRecord,
  readFleetResourceAssets,
  readFleetResourceRecord,
  readFleetResourceRegistry,
  writeFleetResourceRegistry,
} from "./fleet-resource-store";
export {
  reserveFleetDetail,
  releaseFleetReservation,
} from "./fleet-reservations";

type Transaction = <T>(
  actor: FleetActor,
  work: (state: FleetState, client: PoolClient) => Promise<T>,
) => Promise<T>;
type Access = (
  state: FleetState,
  actor: FleetActor,
) => { fleetIds: readonly string[]; roles: readonly string[] } | null;
const savePackage = z
  .object({
    operationId: FleetCanonicalIdSchema,
    expectedVersion: z.number().int().nonnegative(),
    package: FleetRigPackageSchema,
  })
  .strict();
const saveDetail = z
  .object({
    operationId: FleetCanonicalIdSchema,
    expectedVersion: z.number().int().nonnegative(),
    detail: FleetDetailSchema,
  })
  .strict();
const queryPage = z
  .object({
    after: FleetCanonicalIdSchema.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(50),
  })
  .strict();

export function createFleetDetailsOperations(
  transaction: Transaction,
  access: Access,
) {
  function scope(state: FleetState, actor: FleetActor, write = false) {
    const grant =
      access(state, actor) ??
      (state.enabled &&
      actor.role === "vendor" &&
      actor.membershipRole === "admin"
        ? {
            fleetIds: state.fleets.map((row) => row.id),
            roles: ["fleet_manager"],
          }
        : null);
    if (
      !state.enabled ||
      !grant ||
      (write &&
        (actor.readOnly ||
          !grant.roles.some((role) =>
            ["fleet_manager", "dispatcher"].includes(role),
          )))
    )
      throw new FleetError("fleet.dispatch_required", 403);
    return grant;
  }
  async function currentPackage(
    client: PoolClient,
    actor: FleetActor,
    registry: Awaited<ReturnType<typeof readFleetResourceRegistry>>,
    id: string,
    version?: number,
  ): Promise<FleetRigPackage> {
    const current = registry.rigPackages.find(
      (row) =>
        row.id === id && (version === undefined || row.version === version),
    );
    const historical =
      current ??
      (await readFleetResourceRecord(
        client,
        actor.companyId,
        "fleet-rig-package",
        id,
        version,
      ));
    if (!historical) throw new FleetError("fleet.rig_package_not_found", 404);
    return FleetRigPackageSchema.parse(historical);
  }
  async function snapshot(
    state: FleetState,
    client: PoolClient,
    actor: FleetActor,
    detail: FleetDetail,
  ): Promise<FleetDetailSnapshot> {
    const grant = scope(state, actor);
    if (
      detail.companyId !== actor.companyId ||
      !detail.accessGroupIds.some((id) => grant.fleetIds.includes(id)) ||
      (!grant.roles.some((role) =>
        ["fleet_manager", "dispatcher"].includes(role),
      ) &&
        detail.driverUserId !== actor.userId)
    )
      throw new FleetError("fleet.detail_not_found", 404);
    const registry = await readFleetResourceRegistry(client, actor.companyId);
    const rigPackage = detail.rigPackageId
      ? await currentPackage(
          client,
          actor,
          registry,
          detail.rigPackageId,
          detail.rigPackageVersion!,
        )
      : null;
    const assets = await readFleetResourceAssets(
      client,
      actor,
      state,
      [
        detail.vehicleAssetId,
        ...(rigPackage?.components.map((row) => row.assetId) ?? []),
      ],
      true,
    );
    const driver = await client.query(
      "SELECT id,display_name FROM users WHERE id=$1",
      [detail.driverUserId],
    );
    if (!driver.rows.length) throw new FleetError("fleet.driver_unavailable");
    return FleetDetailSnapshotSchema.parse({
      detail,
      rigPackage,
      labels: {
        truck: assets.find((row) => row.id === detail.vehicleAssetId)!.name,
        rigPackage: rigPackage?.name ?? null,
        driver: driver.rows[0].display_name,
        components:
          rigPackage?.components.map((row) => ({
            assetId: row.assetId,
            label: assets.find((asset) => asset.id === row.assetId)!.name,
          })) ?? [],
      },
      carrierOfRecordId: actor.companyId,
      snapshottedAt: new Date().toISOString(),
    });
  }
  async function receipt(
    client: PoolClient,
    actor: FleetActor,
    operationId: string,
    fingerprint: string,
  ): Promise<unknown | null> {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `fleet-resource-operation:${operationId}`,
    ]);
    const result = await client.query(
      "SELECT user_id,vendor_id,tool_output FROM assistant_action_audit WHERE target_type='fleet-resource-operation' AND target_id=$1 ORDER BY id DESC LIMIT 1",
      [operationId],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (
      row.user_id !== actor.userId ||
      row.vendor_id !== actor.companyId ||
      row.tool_output.fingerprint !== fingerprint
    )
      throw new FleetError("fleet.operation_conflict");
    return row.tool_output.result;
  }
  async function saveReceipt(
    client: PoolClient,
    actor: FleetActor,
    operationId: string,
    fingerprint: string,
    result: FleetDetail | FleetRigPackage,
  ) {
    await appendFleetResourceRecord(
      client,
      actor,
      "fleet-resource-operation",
      operationId,
      { operationId, fingerprint, result },
    );
  }
  function writableAssets(
    state: FleetState,
    grant: ReturnType<typeof scope>,
    ids: string[],
    actor: FleetActor,
  ) {
    if (
      !(actor.role === "vendor" && actor.membershipRole === "admin") &&
      !ids.every((id) =>
        state.fleets.some(
          (group) =>
            grant.fleetIds.includes(group.id) &&
            group.equipmentAssetIds.includes(id),
        ),
      )
    )
      throw new FleetError("fleet.equipment_grant_required", 403);
  }
  return {
    fleetResourceReceipt: (actor: FleetActor, operationId: string) =>
      transaction(actor, async (state, client) => {
        const grant = scope(state, actor);
        operationId=FleetCanonicalIdSchema.parse(operationId);
        if (
          !grant.roles.some((role) =>
            ["fleet_manager", "dispatcher"].includes(role),
          )
        )
          throw new FleetError("fleet.dispatch_required", 403);
        const found = await client.query(
          "SELECT user_id,tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-resource-operation' AND target_id=$2 ORDER BY id DESC LIMIT 1",
          [actor.companyId, operationId],
        );
        if (!found.rows.length || found.rows[0].user_id !== actor.userId)
          throw new FleetError("fleet.operation_not_found", 404);
        const body = FleetResourceReceiptSchema.parse(
          found.rows[0].tool_output,
        );
        if ("driverUserId" in body.result)
          await snapshot(state, client, actor, body.result);
        else
          writableAssets(
            state,
            grant,
            body.result.components.map((row) => row.assetId),
            actor,
          );
        return body;
      }),
    fleetResourceHistory: (
      actor: FleetActor,
      type: "detail" | "rig_package",
      id: string,
      raw: unknown = {},
    ) =>
      transaction(actor, async (state, client) => {
        const grant = scope(state, actor),
          query = z
            .object({
              after: z.coerce.number().int().positive().optional(),
              limit: z.coerce.number().int().min(1).max(50).default(50),
            })
            .strict()
            .parse(raw);
        id=FleetCanonicalIdSchema.parse(id);
        const targetType =
          type === "detail" ? "fleet-detail" : "fleet-rig-package";
        const current = await readFleetResourceRecord(
          client,
          actor.companyId,
          targetType,
          id,
        );
        if (!current) throw new FleetError("fleet.detail_not_found", 404);
        if (type === "detail")
          await snapshot(
            state,
            client,
            actor,
            FleetDetailSchema.parse(current),
          );
        else {
          if (
            !grant.roles.some((role) =>
              ["fleet_manager", "dispatcher"].includes(role),
            )
          )
            throw new FleetError("fleet.dispatch_required", 403);
          writableAssets(
            state,
            grant,
            FleetRigPackageSchema.parse(current).components.map(
              (row) => row.assetId,
            ),
            actor,
          );
        }
        const found = await client.query(
          "SELECT id,tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type=$2 AND target_id=$3 AND ($4::int IS NULL OR id<$4) ORDER BY id DESC LIMIT $5",
          [
            actor.companyId,
            targetType,
            id,
            query.after ?? null,
            query.limit + 1,
          ],
        );
        return {
          records: found.rows.slice(0, query.limit).map((row) => ({
            id: row.id as number,
            record:
              type === "detail"
                ? FleetDetailSchema.parse(row.tool_output)
                : FleetRigPackageSchema.parse(row.tool_output),
          })),
          nextCursor:
            found.rows.length > query.limit
              ? (found.rows[query.limit - 1].id as number)
              : null,
        };
      }),
    readFleetDetails: (actor: FleetActor, raw: unknown = {}) =>
      transaction(actor, async (state, client) => {
        const grant = scope(state, actor),
          query = queryPage.parse(raw),
          registry = await readFleetResourceRegistry(client, actor.companyId);
        const rows = registry.details
          .filter(
            (row) =>
              !row.archivedAt &&
              row.accessGroupIds.some((id) => grant.fleetIds.includes(id)) &&
              (grant.roles.some((role) =>
                ["fleet_manager", "dispatcher"].includes(role),
              ) ||
                row.driverUserId === actor.userId) &&
              (!query.after || row.id > query.after),
          )
          .sort((a, b) => a.id.localeCompare(b.id));
        return {
          details: rows.slice(0, query.limit),
          nextCursor:
            rows.length > query.limit ? rows[query.limit - 1].id : null,
          canManage:
            !actor.readOnly &&
            grant.roles.some((role) =>
              ["fleet_manager", "dispatcher"].includes(role),
            ),
        };
      }),
    readFleetRigPackages: (actor: FleetActor, raw: unknown = {}) =>
      transaction(actor, async (state, client) => {
        const grant = scope(state, actor),
          query = queryPage.parse(raw),
          registry = await readFleetResourceRegistry(client, actor.companyId);
        const rows = registry.rigPackages
          .filter(
            (row) =>
              !row.archivedAt &&
              (!query.after || row.id > query.after) &&
              ((actor.role === "vendor" && actor.membershipRole === "admin") ||
                row.components.every((component) =>
                  state.fleets.some(
                    (group) =>
                      grant.fleetIds.includes(group.id) &&
                      group.equipmentAssetIds.includes(component.assetId),
                  ),
                )),
          )
          .sort((a, b) => a.id.localeCompare(b.id));
        if (
          !grant.roles.some((role) =>
            ["fleet_manager", "dispatcher"].includes(role),
          )
        )
          throw new FleetError("fleet.dispatch_required", 403);
        return {
          rigPackages: rows.slice(0, query.limit),
          nextCursor:
            rows.length > query.limit ? rows[query.limit - 1].id : null,
        };
      }),
    fleetRigPackage: (actor: FleetActor, id: string) =>
      transaction(actor, async (state, client) => {
        const grant = scope(state, actor);
        id=FleetCanonicalIdSchema.parse(id);
        if (
          !grant.roles.some((role) =>
            ["fleet_manager", "dispatcher"].includes(role),
          )
        )
          throw new FleetError("fleet.dispatch_required", 403);
        const registry = await readFleetResourceRegistry(
            client,
            actor.companyId,
          ),
          value = await currentPackage(client, actor, registry, id);
        writableAssets(
          state,
          grant,
          value.components.map((row) => row.assetId),
          actor,
        );
        return value;
      }),
    fleetDetailSnapshot: (actor: FleetActor, id: string) =>
      transaction(actor, async (state, client) => {
        id=FleetCanonicalIdSchema.parse(id);
        const registry = await readFleetResourceRegistry(
          client,
          actor.companyId,
        );
        const value =
          registry.details.find((row) => row.id === id) ??
          (await readFleetResourceRecord(
            client,
            actor.companyId,
            "fleet-detail",
            id,
          ));
        if (!value) throw new FleetError("fleet.detail_not_found", 404);
        return snapshot(state, client, actor, FleetDetailSchema.parse(value));
      }),
    saveFleetRigPackage: (actor: FleetActor, raw: unknown) =>
      transaction(actor, async (state, client) => {
        const grant = scope(state, actor, true),
          body = savePackage.parse(raw),
          value = body.package;
        if (value.companyId !== actor.companyId)
          throw new FleetError("fleet.dispatch_required", 403);
        const fingerprint = createHash("sha256")
          .update(
            JSON.stringify(["package", actor.companyId, actor.userId, body]),
          )
          .digest("hex");
        const priorReceipt = await receipt(
          client,
          actor,
          body.operationId,
          fingerprint,
        );
        if (priorReceipt) {
          const saved = FleetRigPackageSchema.parse(priorReceipt);
          writableAssets(
            state,
            grant,
            saved.components.map((row) => row.assetId),
            actor,
          );
          return saved;
        }
        const registry = await readFleetResourceRegistry(
            client,
            actor.companyId,
          ),
          current =
            registry.rigPackages.find((row) => row.id === value.id) ??
            (await readFleetResourceRecord(
              client,
              actor.companyId,
              "fleet-rig-package",
              value.id,
            ));
        const prior = current ? FleetRigPackageSchema.parse(current) : null;
        if (prior)
          writableAssets(
            state,
            grant,
            prior.components.map((row) => row.assetId),
            actor,
          );
        if (
          (prior?.version ?? 0) !== body.expectedVersion ||
          value.version !== body.expectedVersion + 1
        )
          throw new FleetError("fleet.version_conflict");
        const ids = value.components.map((row) => row.assetId);
        writableAssets(state, grant, ids, actor);
        const assets = await readFleetResourceAssets(
          client,
          actor,
          state,
          ids,
          Boolean(value.archivedAt),
        );
        if (assets.some((row) => ["vehicle", "truck"].includes(row.category)))
          throw new FleetError("fleet.rig_component_kind_required", 400);
        registry.rigPackages = registry.rigPackages.filter(
          (row) => row.id !== value.id,
        );
        if (!value.archivedAt) registry.rigPackages.push(value);
        await appendFleetResourceRecord(
          client,
          actor,
          "fleet-rig-package",
          value.id,
          value,
        );
        await writeFleetResourceRegistry(client, actor, registry);
        await saveReceipt(client, actor, body.operationId, fingerprint, value);
        return value;
      }),
    saveFleetDetail: (actor: FleetActor, raw: unknown) => {
      const body = saveDetail.parse(raw);
      return transaction(
        { ...actor, schedulingDriverUserIds: [body.detail.driverUserId] },
        async (state, client) => {
          const grant = scope(state, actor, true),
            value = body.detail;
          if (
            value.companyId !== actor.companyId ||
            !value.accessGroupIds.length ||
            !value.accessGroupIds.every((id) => grant.fleetIds.includes(id))
          )
            throw new FleetError("fleet.dispatch_required", 403);
          const fingerprint = createHash("sha256")
              .update(
                JSON.stringify(["detail", actor.companyId, actor.userId, body]),
              )
              .digest("hex"),
            priorReceipt = await receipt(
              client,
              actor,
              body.operationId,
              fingerprint,
            );
          if (priorReceipt) {
            const saved = FleetDetailSchema.parse(priorReceipt);
            await snapshot(state, client, actor, saved);
            return saved;
          }
          const registry = await readFleetResourceRegistry(
              client,
              actor.companyId,
            ),
            current =
              registry.details.find((row) => row.id === value.id) ??
              (await readFleetResourceRecord(
                client,
                actor.companyId,
                "fleet-detail",
                value.id,
              )),
            prior = current ? FleetDetailSchema.parse(current) : null;
          if (
            prior &&
            !prior.accessGroupIds.some((id) => grant.fleetIds.includes(id))
          )
            throw new FleetError("fleet.detail_not_found", 404);
          if (
            (prior?.version ?? 0) !== body.expectedVersion ||
            value.version !== body.expectedVersion + 1
          )
            throw new FleetError("fleet.version_conflict");
          const rig = value.rigPackageId
            ? registry.rigPackages.find(
                (row) =>
                  row.id === value.rigPackageId &&
                  row.version === value.rigPackageVersion,
              )
            : null;
          if (value.rigPackageId && !rig)
            throw new FleetError("fleet.rig_package_not_found", 404);
          const ids = [
            value.vehicleAssetId,
            ...(rig?.components.map((row) => row.assetId) ?? []),
          ];
          writableAssets(state, grant, ids, actor);
          const assets = await readFleetResourceAssets(
            client,
            actor,
            state,
            ids,
            Boolean(value.archivedAt),
          );
          if (
            !["vehicle", "truck"].includes(
              assets.find((row) => row.id === value.vehicleAssetId)!.category,
            )
          )
            throw new FleetError("fleet.equipment_kind_required", 400);
          const driverGrant = state.grants.find(
            (row) => row.userId === value.driverUserId,
          );
          if (
            !driverGrant?.roles.includes("driver") ||
            !value.accessGroupIds.some((id) =>
              driverGrant.fleetIds.includes(id),
            )
          )
            throw new FleetError("fleet.driver_grant_required", 403);
          const driver = await client.query(
            "SELECT u.id FROM users u JOIN vendor_people vp ON vp.user_id=u.id JOIN user_org_memberships m ON m.user_id=u.id AND m.vendor_id=vp.vendor_id AND m.org_type='vendor' WHERE u.id=$1 AND vp.vendor_id=$2 AND vp.is_active=true AND vp.deleted_at IS NULL AND u.suspended_at IS NULL",
            [value.driverUserId, actor.companyId],
          );
          if (!driver.rows.length)
            throw new FleetError("fleet.driver_unavailable");
          await snapshot(state, client, actor, value);
          registry.details = registry.details.filter(
            (row) => row.id !== value.id,
          );
          if (!value.archivedAt) registry.details.push(value);
          await appendFleetResourceRecord(
            client,
            actor,
            "fleet-detail",
            value.id,
            value,
          );
          await writeFleetResourceRegistry(client, actor, registry);
          await saveReceipt(
            client,
            actor,
            body.operationId,
            fingerprint,
            value,
          );
          return value;
        },
      );
    },
  };
}
