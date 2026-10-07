import { createFleetEvidenceOperations } from "./fleet-evidence";
import { createFleetPlanningOperations } from "./fleet-planning";
import { checkFleetInspectionRequirements, checkFleetManifestRequirements } from "@workspace/api-zod";
import type { FleetItemizedAuthority } from "./fleet-itemized-repository";
import {
  createFleetMaintenanceOperations,
  recordFleetInspectionException,
} from "./fleet-maintenance";
import { createFleetReportingOperations } from "./fleet-reporting";
import { createFleetGateOperations } from "./fleet-gate-correlation";
import { createFleetLocationOperations } from "./fleet-location";
import { createFleetEtaOperations } from "./fleet-eta";
import { createHash, randomUUID } from "node:crypto";
import {
  CreateFleetRunSchema,
  FleetActionInputSchema,
  FleetDefinitionSchema,
  FleetGrantSchema,
  FleetSetupInputSchema,
  FleetWorkspacePreferenceInputSchema,
  type FleetSetup,
  type FleetRun,
  type FleetOverview,
  type FleetResources,
} from "@workspace/api-zod";
import { z } from "zod/v4";
import type { PoolClient } from "pg";
import { ACTIVE_APPROVAL_STATUSES } from "@workspace/db";
import { mayPerformFleetAction, type FleetGrant } from "./fleet-permissions";
import {
  FleetError,
  type FleetRepository,
  type FleetState,
  type FleetSessionAuthority,
} from "./fleet-repository";
export type FleetActor = {
  userId: number;
  companyId: number;
} & FleetSessionAuthority &
  FleetItemizedAuthority & {
    currentSiteIds?: number[];
    activeSiteIds?: number[];
    labels?: Map<string, NonNullable<FleetRun["labels"]>>;
  };
function grantFor(state: FleetState, actor: FleetActor): FleetGrant | null {
  const grant = state.grants.find((g) => g.userId === actor.userId);
  if (!state.enabled || !grant || !grant.roles.length) return null;
  const siteIds = grant.siteIds.filter((id) =>
    actor.currentSiteIds?.includes(id),
  );
  const fleetIds = grant.fleetIds.filter((id) =>
    state.fleets.some(
      (f) =>
        f.id === id && f.siteIds.some((siteId) => siteIds.includes(siteId)),
    ),
  );
  return fleetIds.length
    ? { ...grant, siteIds, fleetIds, companyId: actor.companyId }
    : null;
}
function target(run: FleetRun) {
  return {
    companyId: run.companyId,
    fleetId: run.fleetId,
    driverUserId: run.driverUserId,
  };
}
function permitted(
  state: FleetState,
  actor: FleetActor,
  run: FleetRun,
  action: "view" | "dispatch" | "perform_run",
) {
  const grant = grantFor(state, actor);
  const current = actor.currentRunsById
    ? actor.currentRunsById.get(run.id)
    : run;
  if (!current) return false;
  return (
    mayPerformFleetAction(actor.userId, grant, target(current), action) &&
    [...current.siteIds, ...run.siteIds].every(
      (siteId) =>
        grant?.siteIds.includes(siteId) &&
        actor.currentSiteIds?.includes(siteId),
    )
  );
}
function allowed(
  state: FleetState,
  actor: FleetActor,
  run: FleetRun,
): FleetRun["allowedActions"] {
  if (
    !permitted(state, actor, run, "view") ||
    ["cancelled", "completed"].includes(run.status)
  )
    return [];
  const result: FleetRun["allowedActions"] = [];
  if (
    actor.currentRunsById &&
    actor.currentRunsById.get(run.id)?.version !== run.version
  )
    return result;
  const grant = grantFor(state, actor);
  if (run.status === "submitted_for_review")
    return grant?.roles.includes("fleet_manager") ? ["review"] : [];
  if (
    ["draft", "dispatched", "acknowledged"].includes(run.status) &&
    permitted(state, actor, run, "dispatch")
  ) {
    if (run.status === "draft") result.push("dispatch");
    result.push("reassign", "cancel", "link_ticket");
  }
  if (!permitted(state, actor, run, "perform_run")) return result;
  if (run.status === "dispatched") result.push("acknowledge");
  if (run.status === "acknowledged") {
    result.push("inspect", "record_meter");
    const inspection = run.inspections.at(-1);
    if (
      inspection?.outcome === "passed" &&
      inspection.driverUserId === run.driverUserId &&
      inspection.vehicleAssetId === run.vehicleAssetId &&
      inspection.trailerAssetId === run.trailerAssetId &&
      run.records.some(
        (r) =>
          r.kind === "meter" &&
          r.vehicleAssetId === run.vehicleAssetId &&
          ["miles", "kilometers"].includes(r.unit),
      )
    )
      result.push("start");
  }
  if (run.status === "in_progress") {
    if (run.phase === "paused") return [...result, "resume"];
    result.push("pause", "record_fuel", "record_meter");
    if (!run.currentStopId && run.visitedStopIds.length < run.stops.length)
      result.push("arrive_stop");
    if (run.currentStopId) {
      result.push("depart_stop");
      const stop = run.stops.find((s) => s.id === run.currentStopId);
      if (stop?.kind === "pickup") result.push("record_load");
      if (stop?.kind === "delivery") result.push("record_delivery");
    }
    if (
      !run.currentStopId &&
      run.visitedStopIds.length === run.stops.length &&
      run.loads.length &&
      run.loads.every((l) => l.deliveredAt) &&
      run.records.filter(
        (r) => r.kind === "meter" && ["miles", "kilometers"].includes(r.unit),
      ).length >= 2
    )
      result.push("submit_closeout");
  }
  return result;
}
function labelKey(run: FleetRun) {
  return [
    run.id,
    run.driverUserId,
    run.vehicleAssetId,
    run.trailerAssetId,
    ...run.siteIds,
  ].join(":");
}
function project(
  state: FleetState,
  actor: FleetActor,
  run: FleetRun,
): FleetRun {
  if (!permitted(state, actor, run, "view"))
    throw new FleetError("fleet.not_found", 404);
  return {
    ...run,
    labels: actor.labels?.get(labelKey(run)) ?? {
      driverName: null,
      vehicleName: null,
      trailerName: null,
      sites: [],
    },
    canEditDraft: run.status === "draft" && permitted(state, actor, run, "dispatch") && (!actor.currentRunsById || actor.currentRunsById.get(run.id)?.version === run.version),
    allowedActions: allowed(state, actor, run),
  };
}
async function eligible(state: FleetState, client: PoolClient, run: FleetRun) {
  const fleet = state.fleets.find((f) => f.id === run.fleetId);
  if (
    ![run.vehicleAssetId, run.trailerAssetId]
      .filter(Boolean)
      .every((id) => fleet?.equipmentAssetIds.includes(id!))
  )
    throw new FleetError("fleet.equipment_grant_required", 403);
  const driver = state.grants.find((g) => g.userId === run.driverUserId);
  if (
    !driver?.roles.includes("driver") ||
    !driver.fleetIds.includes(run.fleetId) ||
    !run.siteIds.every((id) => driver.siteIds.includes(id))
  )
    throw new FleetError("fleet.driver_grant_required", 403);
  const person = await client.query(
    "SELECT vp.id FROM vendor_people vp JOIN users u ON u.id=vp.user_id JOIN user_org_memberships m ON m.user_id=u.id AND m.vendor_id=vp.vendor_id AND m.org_type='vendor' WHERE vp.user_id=$1 AND vp.vendor_id=$2 AND vp.is_active=true AND vp.deleted_at IS NULL AND u.suspended_at IS NULL",
    [run.driverUserId, run.companyId],
  );
  if (!person.rows.length) throw new FleetError("fleet.driver_unavailable");
  const required =
    state.fleets.find((f) => f.id === run.fleetId)?.requiredCertifications ??
    [];
  if (required.length) {
    const certifications = await client.query(
      "SELECT name FROM employee_certifications WHERE employee_id=$1 AND deleted_at IS NULL AND vendor_verified_at IS NOT NULL AND (expiration_date IS NULL OR expiration_date>=CURRENT_DATE)",
      [person.rows[0].id],
    );
    if (
      !required.every((name) =>
        certifications.rows.some((c) => c.name === name),
      )
    )
      throw new FleetError("fleet.qualifications_required");
  }
  const stopWork = await client.query(
    "SELECT id FROM safety_events WHERE site_location_id=ANY($1::int[]) AND is_stop_work=true AND closed_at IS NULL",
    [run.siteIds],
  );
  if (stopWork.rows.length) throw new FleetError("fleet.site_stop_work");
  for (const assetId of [run.vehicleAssetId, run.trailerAssetId].filter(
    Boolean,
  )) {
    const asset = await client.query(
      "SELECT id,status,category,current_holder_user_id FROM assets WHERE id=$1 AND responsible_org_type='vendor' AND responsible_org_id=$2 AND retired_at IS NULL AND merged_into_id IS NULL AND provisional=false FOR UPDATE",
      [assetId, run.companyId],
    );
    if (
      !asset.rows.length ||
      !["available", "checked_out"].includes(asset.rows[0].status)
    )
      throw new FleetError("fleet.equipment_unavailable");
    if (
      (assetId === run.vehicleAssetId &&
        !["vehicle", "truck"].includes(asset.rows[0].category)) ||
      (assetId === run.trailerAssetId && asset.rows[0].category !== "trailer")
    )
      throw new FleetError("fleet.equipment_kind_required");
    if (
      asset.rows[0].status === "checked_out" &&
      asset.rows[0].current_holder_user_id !== run.driverUserId
    )
      throw new FleetError("fleet.equipment_custody_conflict");
    const hold = await client.query(
      "SELECT id FROM asset_holds WHERE asset_id=$1 AND released_at IS NULL",
      [assetId],
    );
    if (hold.rows.length) throw new FleetError("fleet.equipment_on_hold");
  }
  if (run.trailerAssetId === run.vehicleAssetId)
    throw new FleetError("fleet.distinct_equipment_required");
  const sites = await client.query(
    "SELECT s.id FROM site_locations s JOIN partner_vendor_relationships r ON r.partner_id=s.partner_id AND r.vendor_id=$1 WHERE s.id=ANY($2::int[]) AND s.is_active=true AND COALESCE(s.hidden,false)=false AND r.status=ANY($3::text[])",
    [run.companyId, run.siteIds, [...ACTIVE_APPROVAL_STATUSES]],
  );
  if (!run.siteIds.every((id) => sites.rows.some((row) => row.id === id)))
    throw new FleetError("fleet.site_forbidden", 403);
  if (
    state.runs.some(
      (other) =>
        other.id !== run.id &&
        ["dispatched", "acknowledged", "in_progress"].includes(other.status) &&
        (other.driverUserId === run.driverUserId ||
          [other.vehicleAssetId, other.trailerAssetId]
            .filter(Boolean)
            .some((id) =>
              [run.vehicleAssetId, run.trailerAssetId].includes(id),
            )),
    )
  )
    throw new FleetError("fleet.assignment_conflict");
}
async function setupEquipment(client: PoolClient, companyId: number) {
  const assets = await client.query(
    "SELECT id,name,category FROM assets WHERE responsible_org_type='vendor' AND responsible_org_id=$1 AND retired_at IS NULL AND merged_into_id IS NULL AND provisional=false AND category IN ('vehicle','truck','trailer') ORDER BY name LIMIT 501",
    [companyId],
  );
  if (assets.rows.length > 500)
    throw new FleetError("fleet.equipment_limit_reached");
  return assets.rows.map((a) => ({
    assetId: a.id as string,
    name: a.name as string,
    category: a.category as string,
  }));
}
async function setupSites(client: PoolClient, companyId: number) {
  const result = await client.query(
    "SELECT DISTINCT s.id,s.name FROM site_locations s JOIN partner_vendor_relationships r ON r.partner_id=s.partner_id WHERE r.vendor_id=$1 AND r.status=ANY($2::text[]) AND s.is_active=true AND COALESCE(s.hidden,false)=false ORDER BY s.name LIMIT 201",
    [companyId, [...ACTIVE_APPROVAL_STATUSES]],
  );
  if (result.rows.length > 200)
    throw new FleetError("fleet.site_limit_reached");
  return result.rows.map((row) => ({
    siteId: row.id as number,
    name: row.name as string,
  }));
}
export function createFleetService(repository: FleetRepository) {
  const transaction = <T>(
    actor: FleetActor,
    operation: (state: FleetState, client: PoolClient) => Promise<T>,
  ) =>
    repository.transaction(
      actor.companyId,
      actor.userId,
      async (state, client) => {
        const siteIds =
          state.grants.find((g) => g.userId === actor.userId)?.siteIds ?? [];
        const sites = await client.query(
          "SELECT s.id,s.is_active FROM site_locations s JOIN partner_vendor_relationships r ON r.partner_id=s.partner_id WHERE r.vendor_id=$1 AND s.id=ANY($2::int[]) AND r.status=ANY($3::text[]) AND COALESCE(s.hidden,false)=false FOR SHARE OF s,r",
          [actor.companyId, siteIds, [...ACTIVE_APPROVAL_STATUSES]],
        );
        actor.currentSiteIds = sites.rows.map((s) => s.id);
        actor.activeSiteIds = sites.rows
          .filter((s) => s.is_active)
          .map((s) => s.id);
        const visible = [...state.runs, ...(actor.pageRuns ?? [])].filter((r) =>
          permitted(state, actor, r, "view"),
        );
        const equipment = await client.query(
          "SELECT id,name FROM assets WHERE id=ANY($1::uuid[]) AND responsible_org_type='vendor' AND responsible_org_id=$2",
          [
            [
              ...new Set(
                visible.flatMap((r) => [
                  r.vehicleAssetId,
                  ...(r.trailerAssetId ? [r.trailerAssetId] : []),
                ]),
              ),
            ],
            actor.companyId,
          ],
        );
        const users = await client.query(
          "SELECT id,display_name FROM users WHERE id=ANY($1::int[])",
          [[...new Set(visible.map((r) => r.driverUserId))]],
        );
        const names = await client.query(
          "SELECT id,name FROM site_locations WHERE id=ANY($1::int[])",
          [[...new Set(visible.flatMap((r) => r.siteIds))]],
        );
        actor.labels = new Map(
          visible.map((r) => [
            labelKey(r),
            {
              driverName:
                users.rows.find((u) => u.id === r.driverUserId)?.display_name ??
                null,
              vehicleName:
                equipment.rows.find((a) => a.id === r.vehicleAssetId)?.name ??
                null,
              trailerName:
                equipment.rows.find((a) => a.id === r.trailerAssetId)?.name ??
                null,
              sites: names.rows
                .filter(
                  (s) => r.siteIds.includes(s.id) && typeof s.name === "string",
                )
                .map((s) => ({ siteId: s.id, name: s.name })),
            },
          ]),
        );
        return operation(state, client);
      },
      actor,
    );
  const locations = createFleetLocationOperations(transaction, permitted);
  return {
    recordLocation: locations.record,
    locationObservations: locations.observations,
    ...createFleetEtaOperations(
      transaction,
      permitted,
      locations.readObservations,
    ),
    ...createFleetEvidenceOperations(transaction, permitted),
    ...createFleetPlanningOperations(transaction, permitted, eligible, project),
    ...createFleetMaintenanceOperations(transaction, grantFor),
    ...createFleetReportingOperations(transaction, grantFor),
    ...createFleetGateOperations(transaction, permitted),
    overview: (actor: FleetActor): Promise<FleetOverview> =>
      transaction(
        Object.assign(actor, { runPage: actor.runPage ?? { limit: 50 } }),
        async (state, client) => {
          const admin = await client.query(
            "SELECT id FROM user_org_memberships WHERE user_id=$1 AND vendor_id=$2 AND org_type='vendor' AND role='admin' AND id=$3",
            [actor.userId, actor.companyId, actor.activeMembershipId],
          );
          const grant = grantFor(state, actor);
          const roles = grant?.roles ?? [];
          return {
            ...(Number.isInteger(actor.activeMembershipId) &&
            Number.isInteger(actor.sv)
              ? {
                  accountScope: {
                    userId: actor.userId,
                    companyId: actor.companyId,
                    membershipId: actor.activeMembershipId!,
                    sessionVersion: actor.sv!,
                  },
                }
              : {}),
            companyId: actor.companyId,
            preference: state.preferences.find(
              (p) => p.userId === actor.userId,
            ) ?? {
              userId: actor.userId,
              version: 1,
              defaultWorkspace: "standard",
              selectedFleetId: null,
            },
            enabled: state.enabled,
            roles: [...roles],
            capabilities: {
              canDispatch:
                roles.includes("fleet_manager") || roles.includes("dispatcher"),
              canManage: roles.includes("fleet_manager"),
              canDrive: roles.includes("driver"),
              canMaintain: roles.includes("fleet_manager"),
              canReportDefect:
                roles.includes("fleet_manager") || roles.includes("driver"),
              canReleaseHold:
                roles.includes("fleet_manager") &&
                grant?.safetyRelease === true,
              canSetup:
                actor.role === "vendor" &&
                actor.membershipRole === "admin" &&
                admin.rows.length > 0,
            },
            fleets: state.fleets.filter((f) => grant?.fleetIds.includes(f.id)),
            page: {
              limit: actor.runPage?.limit ?? 50,
              nextCursor: actor.nextRunCursor ?? null,
            },
            runs: (actor.pageRuns ?? state.runs)
              .filter(
                (run) => !actor.pageRunIds || actor.pageRunIds.includes(run.id),
              )
              .filter((run) => permitted(state, actor, run, "view"))
              .map((run) => project(state, actor, run)),
            observations: await locations.readObservations(
              state,
              client,
              actor,
            ),
            unavailableIntegrations: [
              "vehicle_telemetry",
              "device_capture",
              "inspection_media",
              "delivery_media",
              "regulated_compliance",
              "ticket_billing_linkage",
            ],
            generatedAt: new Date().toISOString(),
          };
        },
      ),
    detail: (actor: FleetActor, runId: string) =>
      transaction(Object.assign(actor, { runId }), async (state) => {
        const run = state.runs.find((r) => r.id === runId);
        if (!run) throw new FleetError("fleet.not_found", 404);
        return project(state, actor, run);
      }),
    resources: (actor: FleetActor): Promise<FleetResources> =>
      transaction(actor, async (state, client) => {
        const grant = grantFor(state, actor);
        if (
          !grant?.roles.some((r) => r === "fleet_manager" || r === "dispatcher")
        )
          throw new FleetError("fleet.dispatch_required", 403);
        const userIds = state.grants
          .filter(
            (g) =>
              g.roles.includes("driver") &&
              g.fleetIds.some((id) => grant.fleetIds.includes(id)),
          )
          .map((g) => g.userId);
        const people = await client.query(
          "SELECT DISTINCT u.id,u.display_name FROM users u JOIN vendor_people vp ON vp.user_id=u.id JOIN user_org_memberships m ON m.user_id=u.id AND m.vendor_id=vp.vendor_id WHERE vp.vendor_id=$1 AND u.id=ANY($2::int[]) AND vp.is_active=true AND vp.deleted_at IS NULL AND u.suspended_at IS NULL",
          [actor.companyId, userIds],
        );
        const assets = await client.query(
          "SELECT a.id,a.name,a.category,a.status,a.current_holder_user_id,EXISTS(SELECT 1 FROM asset_holds h WHERE h.asset_id=a.id AND h.released_at IS NULL) AS held FROM assets a WHERE responsible_org_type='vendor' AND responsible_org_id=$1 AND retired_at IS NULL AND merged_into_id IS NULL AND provisional=false AND category IN ('vehicle','truck','trailer') ORDER BY name LIMIT 201",
          [actor.companyId],
        );
        if (assets.rows.length > 200)
          throw new FleetError("fleet.resource_limit_reached");
        const tickets = await client.query(
          "SELECT t.id,t.site_location_id,t.status FROM tickets t WHERE t.vendor_id=$1 AND t.site_location_id=ANY($2::int[]) AND ($3::boolean OR t.field_employee_id=$4 OR t.foreman_user_id=$5 OR t.acting_foreman_user_id=$5 OR EXISTS(SELECT 1 FROM ticket_crew tc WHERE tc.ticket_id=t.id AND tc.employee_id=$4 AND tc.removed_at IS NULL)) ORDER BY t.id DESC LIMIT 201",
          [
            actor.companyId,
            actor.currentSiteIds ?? [],
            actor.role === "vendor",
            actor.vendorPeopleId ?? null,
            actor.userId,
          ],
        );
        if (tickets.rows.length > 200)
          throw new FleetError("fleet.ticket_limit_reached");
        return {
          tickets: tickets.rows.map((t) => ({
            id: t.id,
            siteId: t.site_location_id,
            status: t.status,
          })),
          drivers: people.rows.map((row) => ({
            userId: row.id,
            name: row.display_name,
            fleetIds: state.grants
              .find((g) => g.userId === row.id)!
              .fleetIds.filter((id) => grant.fleetIds.includes(id)),
          })),
          equipment: assets.rows
            .filter((row) =>
              state.fleets.some(
                (f) =>
                  grant.fleetIds.includes(f.id) &&
                  f.equipmentAssetIds.includes(row.id),
              ),
            )
            .map((row) => ({
              id: row.id,
              name: row.name,
              category: row.category,
              status: row.status,
              dispatchable:
                !row.held &&
                (row.status === "available" ||
                  (row.status === "checked_out" &&
                    people.rows.some(
                      (p) => p.id === row.current_holder_user_id,
                    ))),
            })),
        };
      }),
    preference: (actor: FleetActor, input: unknown) =>
      transaction(actor, async (state, client) => {
        const body = FleetWorkspacePreferenceInputSchema.parse(input);
        const current = state.preferences.find(
          (p) => p.userId === actor.userId,
        );
        if ((current?.version ?? 1) !== body.expectedVersion)
          throw new FleetError("fleet.version_conflict");
        const grant = grantFor(state, actor);
        if (
          body.defaultWorkspace === "fleet_desk" &&
          !grant?.roles.some((r) => ["fleet_manager", "dispatcher"].includes(r))
        )
          throw new FleetError("fleet.dispatch_required", 403);
        if (
          body.defaultWorkspace === "fleet_my_day" &&
          !grant?.roles.includes("driver")
        )
          throw new FleetError("fleet.driver_grant_required", 403);
        if (
          body.selectedFleetId &&
          !grant?.fleetIds.includes(body.selectedFleetId)
        )
          throw new FleetError("fleet.fleet_forbidden", 403);
        if (!current && state.preferences.length >= 500)
          throw new FleetError("fleet.store_capacity_reached");
        const next = {
          userId: actor.userId,
          version: body.expectedVersion + 1,
          defaultWorkspace: body.defaultWorkspace,
          selectedFleetId: body.selectedFleetId,
        };
        if (current) Object.assign(current, next);
        else state.preferences.push(next);
        await client.query(
          "INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_input,tool_output,result_status) VALUES($1,$2,'fleet','typed','canonical','fleet_preference','fleet-preference','user',$3,$4::jsonb,$5::jsonb,'completed')",
          [
            actor.userId,
            actor.companyId,
            String(actor.userId),
            JSON.stringify(body),
            JSON.stringify(next),
          ],
        );
        return next;
      }),
    setupRead: (actor: FleetActor): Promise<FleetSetup> =>
      transaction(actor, async (state, client) => {
        const admin = await client.query(
          "SELECT id FROM user_org_memberships WHERE user_id=$1 AND vendor_id=$2 AND org_type='vendor' AND role='admin'",
          [actor.userId, actor.companyId],
        );
        if (
          !admin.rows.length ||
          actor.role !== "vendor" ||
          actor.membershipRole !== "admin"
        )
          throw new FleetError("fleet.company_admin_required", 403);
        const members = await client.query(
          "SELECT DISTINCT u.id,u.display_name FROM users u JOIN user_org_memberships m ON m.user_id=u.id WHERE m.vendor_id=$1 AND m.org_type='vendor' AND u.suspended_at IS NULL ORDER BY u.display_name LIMIT 501",
          [actor.companyId],
        );
        if (members.rows.length > 500)
          throw new FleetError("fleet.member_limit_reached");
        return {
          expectedVersion: state.version,
          enabled: state.enabled,
          fleets: state.fleets,
          grants: state.grants,
          supportGrants: state.supportGrants,
          members: members.rows.map((row) => ({
            userId: row.id,
            name: row.display_name,
          })),
          sites: await setupSites(client, actor.companyId),
          equipment: await setupEquipment(client, actor.companyId),
        };
      }),
    setup: (actor: FleetActor, input: unknown) =>
      transaction(actor, async (state, client) => {
        const body = FleetSetupInputSchema.parse(input);
        const member = await client.query(
          "SELECT id FROM user_org_memberships WHERE user_id=$1 AND vendor_id=$2 AND org_type='vendor' AND role='admin'",
          [actor.userId, actor.companyId],
        );
        if (
          !member.rows.length ||
          actor.role !== "vendor" ||
          actor.membershipRole !== "admin"
        )
          throw new FleetError("fleet.company_admin_required", 403);
        if (state.version !== body.expectedVersion)
          throw new FleetError("fleet.version_conflict");
        if (
          new Set(body.fleets.map((f) => f.id)).size !== body.fleets.length ||
          new Set(body.grants.map((g) => g.userId)).size !== body.grants.length
        )
          throw new FleetError("fleet.duplicate_configuration", 400);
        const equipment = await setupEquipment(client, actor.companyId);
        if (
          !body.fleets.every((f) =>
            f.equipmentAssetIds.every((id) =>
              equipment.some((e) => e.assetId === id),
            ),
          )
        )
          throw new FleetError("fleet.equipment_grant_required", 403);
        const sites = await setupSites(client, actor.companyId);
        if (
          !body.fleets.every((f) =>
            f.siteIds.every((id) => sites.some((s) => s.siteId === id)),
          )
        )
          throw new FleetError("fleet.site_forbidden", 403);
        const members = await client.query(
          "SELECT m.user_id FROM user_org_memberships m JOIN users u ON u.id=m.user_id WHERE m.vendor_id=$1 AND m.org_type='vendor' AND m.user_id=ANY($2::int[]) AND u.suspended_at IS NULL",
          [actor.companyId, body.grants.map((g) => g.userId)],
        );
        if (body.supportGrants) {
          if (
            new Set(body.supportGrants.map((grant) => grant.userId)).size !==
            body.supportGrants.length
          )
            throw new FleetError("fleet.invalid_support_grant", 400);
          const admins = await client.query(
            "SELECT id FROM users WHERE id=ANY($1::int[]) AND role='admin' AND suspended_at IS NULL FOR SHARE",
            [body.supportGrants.map((grant) => grant.userId)],
          );
          for (const grant of body.supportGrants)
            if (
              !admins.rows.some((user) => user.id === grant.userId) ||
              Date.parse(grant.expiresAt) > Date.now() + 7 * 86400000 ||
              !grant.fleetIds.every((id) =>
                body.fleets.some((fleet) => fleet.id === id),
              ) ||
              !grant.siteIds.every(
                (id) =>
                  sites.some((site) => site.siteId === id) &&
                  body.fleets.some(
                    (fleet) =>
                      grant.fleetIds.includes(fleet.id) &&
                      fleet.siteIds.includes(id),
                  ),
              )
            )
              throw new FleetError("fleet.invalid_support_grant", 403);
        }
        for (const g of body.grants)
          if (
            !members.rows.some((m) => m.user_id === g.userId) ||
            !g.fleetIds.every((id) => body.fleets.some((f) => f.id === id)) ||
            !g.siteIds.every((id) =>
              body.fleets.some(
                (f) => g.fleetIds.includes(f.id) && f.siteIds.includes(id),
              ),
            )
          )
            throw new FleetError("fleet.invalid_grant", 403);
        await client.query(
          "INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_input,tool_output,result_status) VALUES($1,$2,'fleet','typed','canonical','fleet_setup','fleet-configuration','vendor',$3,$4::jsonb,$5::jsonb,'completed')",
          [
            actor.userId,
            actor.companyId,
            String(actor.companyId),
            JSON.stringify({
              version: state.version,
              enabled: state.enabled,
              fleets: state.fleets,
              grants: state.grants,
              supportGrants: state.supportGrants,
            }),
            JSON.stringify(body),
          ],
        );
        for (const grant of body.grants.filter((g) =>
          g.roles.includes("driver"),
        )) {
          const person = await client.query(
            "SELECT id FROM vendor_people WHERE user_id=$1 AND vendor_id=$2 AND is_active=true AND deleted_at IS NULL",
            [grant.userId, actor.companyId],
          );
          if (!person.rows.length)
            throw new FleetError("fleet.driver_unavailable");
        }
        state.enabled = body.enabled;
        state.fleets = body.fleets;
        state.grants = body.grants;
        if (body.supportGrants) state.supportGrants = body.supportGrants;
        state.version++;
        return { version: state.version, enabled: state.enabled };
      }),
    create: (actor: FleetActor, input: unknown) =>
      transaction(
        Object.assign(actor, {
          operationId: CreateFleetRunSchema.parse(input).operationId,
        }),
        async (state, client) => {
          const body = CreateFleetRunSchema.parse(input);
          const fleet = state.fleets.find((f) => f.id === body.fleetId);
          const grant = grantFor(state, actor);
          if (
            !fleet ||
            !mayPerformFleetAction(
              actor.userId,
              grant,
              { companyId: actor.companyId, fleetId: body.fleetId },
              "dispatch",
            )
          )
            throw new FleetError("fleet.dispatch_required", 403);
          const fingerprint = createHash("sha256")
            .update(JSON.stringify(body))
            .digest("hex");
          const replay = state.operations.find(
            (o) => o.id === body.operationId,
          );
          if (replay) {
            if (
              replay.actorUserId !== actor.userId ||
              replay.fingerprint !== fingerprint
            )
              throw new FleetError("fleet.operation_conflict");
            return project(state, actor, replay.result);
          }
          if (state.runs.length >= 1000 || state.operations.length >= 2000)
            throw new FleetError("fleet.store_capacity_reached");
          const siteIds = [...new Set(body.stops.map((s) => s.siteId))];
          if (
            !siteIds.every(
              (id) => fleet.siteIds.includes(id) && grant!.siteIds.includes(id),
            ) ||
            new Set(body.stops.map((s) => s.id)).size !== body.stops.length ||
            body.stops.some((s, i) => s.sequence !== i)
          )
            throw new FleetError("fleet.invalid_stops", 400);
          const { operationId: _operationId, ...runFields } = body;
          const run: FleetRun = {
            ...runFields,
            id: randomUUID(),
            companyId: actor.companyId,
            operationalProfile: fleet.operationalProfile ? structuredClone(fleet.operationalProfile) : undefined,
            siteIds,
            status: "draft",
            phase: null,
            pausedFromPhase: null,
            records: [],
            version: 1,
            loads: [],
            inspections: [],
            currentStopId: null,
            visitedStopIds: [],
            events: [],
            linkedTicketId: null,
            allowedActions: [],
          };
          await eligible(state, client, run);
          run.events.push({
            id: randomUUID(),
            operationId: body.operationId,
            type: "created",
            actorUserId: actor.userId,
            recordedAt: new Date().toISOString(),
          });
          state.runs.push(run);
          state.operations.push({
            id: body.operationId,
            actorUserId: actor.userId,
            fingerprint,
            runId: run.id,
            result: structuredClone(run),
          });
          return project(state, actor, run);
        },
      ),
    action: (actor: FleetActor, runId: string, input: unknown) =>
      transaction(
        Object.assign(actor, {
          operationId: FleetActionInputSchema.parse(input).operationId,
          runId,
        }),
        async (state, client) => {
          const body = FleetActionInputSchema.parse(input);
          if (body.capturedAt) {
            const age = Date.now() - Date.parse(body.capturedAt);
            if (age < -300_000 || age > 30 * 86_400_000)
              throw new FleetError("fleet.capture_time_invalid", 400);
          }
          const run = state.runs.find((r) => r.id === runId);
          if (!run) throw new FleetError("fleet.not_found", 404);
          project(state, actor, run);
          const fingerprint = createHash("sha256")
            .update(JSON.stringify({ runId, ...body }))
            .digest("hex");
          const replay = state.operations.find(
            (o) => o.id === body.operationId,
          );
          if (replay) {
            if (
              replay.actorUserId !== actor.userId ||
              replay.fingerprint !== fingerprint
            )
              throw new FleetError("fleet.operation_conflict");
            return project(state, actor, replay.result);
          }
          if (
            !["cancel", "pause"].includes(body.action) &&
            !run.siteIds.every((id) => actor.activeSiteIds?.includes(id))
          )
            throw new FleetError("fleet.site_unavailable", 403);
          if (!allowed(state, actor, run).includes(body.action))
            throw new FleetError("fleet.action_forbidden", 403);
          if (run.version !== body.expectedVersion)
            throw new FleetError("fleet.version_conflict");
          if (run.events.length >= 200 || state.operations.length >= 2000)
            throw new FleetError("fleet.store_capacity_reached");
          if (
            body.action !== "reassign" &&
            (body.driverUserId !== undefined ||
              body.vehicleAssetId !== undefined ||
              body.trailerAssetId !== undefined)
          )
            throw new FleetError("fleet.unexpected_assignment", 400);
          if (
            [
              "arrive_stop",
              "depart_stop",
              "record_load",
              "record_delivery",
              "submit_closeout",
            ].includes(body.action)
          )
            await eligible(state, client, run);
          const priorAssignment = {
            driverUserId: run.driverUserId,
            vehicleAssetId: run.vehicleAssetId,
            trailerAssetId: run.trailerAssetId,
          };
          let maintenanceIds: string[] = [];
          if (
            body.action === "submit_closeout" &&
            run.events.at(-1)?.type === "review" &&
            run.events.at(-1)?.details?.decision === "return" &&
            !body.notes
          )
            throw new FleetError("fleet.correction_notes_required", 400);
          if (body.action === "record_fuel" || body.action === "record_meter") {
            if (
              !body.notes ||
              !body.unit ||
              (body.action === "record_fuel" &&
                (!body.quantity ||
                  !["gallons", "liters"].includes(body.unit))) ||
              (body.action === "record_meter" &&
                (body.reading === undefined ||
                  !["miles", "kilometers", "engine_hours"].includes(body.unit)))
            )
              throw new FleetError("fleet.record_fields_required", 400);
            if (run.records.length >= 200)
              throw new FleetError("fleet.store_capacity_reached");
            if (body.action === "record_meter") {
              const distance = run.records.find(
                (r) =>
                  r.vehicleAssetId === run.vehicleAssetId &&
                  r.kind === "meter" &&
                  ["miles", "kilometers"].includes(r.unit),
              );
              if (
                distance &&
                ["miles", "kilometers"].includes(body.unit) &&
                distance.unit !== body.unit
              )
                throw new FleetError("fleet.meter_unit_mismatch", 400);
              const last = run.records
                .filter(
                  (r) =>
                    r.vehicleAssetId === run.vehicleAssetId &&
                    r.kind === "meter" &&
                    r.unit === body.unit,
                )
                .at(-1);
              if (
                last?.reading !== null &&
                last?.reading !== undefined &&
                body.reading! < last.reading
              )
                throw new FleetError("fleet.meter_regression", 400);
            }
            run.records.push({
              id: randomUUID(),
              vehicleAssetId: run.vehicleAssetId,
              kind: body.action === "record_fuel" ? "fuel" : "meter",
              quantity: body.action === "record_fuel" ? body.quantity! : null,
              reading: body.action === "record_meter" ? body.reading! : null,
              unit: body.unit,
              notes: body.notes,
              recordedByUserId: actor.userId,
              recordedAt: new Date().toISOString(),
              capturedAt: body.capturedAt ?? null,
              source: "user_report",
            });
          } else if (body.action === "pause") {
            if (!body.reason)
              throw new FleetError("fleet.reason_required", 400);
            run.pausedFromPhase = run.phase;
            run.phase = "paused";
          } else if (body.action === "resume") {
            await eligible(state, client, run);
            run.phase = run.pausedFromPhase;
            run.pausedFromPhase = null;
          } else if (body.action === "link_ticket") {
            if (!body.ticketId)
              throw new FleetError("fleet.ticket_required", 400);
            const ticket = await client.query(
              "SELECT t.id FROM tickets t WHERE t.id=$1 AND t.vendor_id=$2 AND t.site_location_id=ANY($3::int[]) AND ($4::boolean OR t.field_employee_id=$5 OR t.foreman_user_id=$6 OR t.acting_foreman_user_id=$6 OR EXISTS(SELECT 1 FROM ticket_crew tc WHERE tc.ticket_id=t.id AND tc.employee_id=$5 AND tc.removed_at IS NULL))",
              [
                body.ticketId,
                actor.companyId,
                run.siteIds,
                actor.role === "vendor",
                actor.vendorPeopleId ?? null,
                actor.userId,
              ],
            );
            if (!ticket.rows.length)
              throw new FleetError("fleet.ticket_not_found", 404);
            run.linkedTicketId = body.ticketId;
          } else if (body.action === "cancel") {
            if (!body.reason)
              throw new FleetError("fleet.reason_required", 400);
            run.status = "cancelled";
          } else if (body.action === "acknowledge") run.status = "acknowledged";
          else if (body.action === "inspect") {
            if (!body.inspectionOutcome || !body.notes)
              throw new FleetError("fleet.inspection_fields_required", 400);
            if (!checkFleetInspectionRequirements(run.operationalProfile, body.inspectionResponses, body.inspectionOutcome)) throw new FleetError("fleet.inspection_fields_required", 400);
            if (run.inspections.length >= 100)
              throw new FleetError("fleet.store_capacity_reached");
            if (body.inspectionOutcome === "defect_reported")
              maintenanceIds = await recordFleetInspectionException(
                client,
                actor,
                run,
                body.operationId,
                body.notes,
              );
            run.inspections.push({
              responses: body.inspectionResponses,
              driverUserId: run.driverUserId,
              vehicleAssetId: run.vehicleAssetId,
              trailerAssetId: run.trailerAssetId,
              outcome: body.inspectionOutcome,
              notes: body.notes,
              recordedByUserId: actor.userId,
              recordedAt: new Date().toISOString(),
              source: "user_report",
            });
          } else if (body.action === "start") {
            await eligible(state, client, run);
            run.status = "in_progress";
            run.phase = "traveling_to_pickup";
          } else if (body.action === "arrive_stop") {
            const stop = run.stops[run.visitedStopIds.length];
            if (!stop || stop.id !== body.stopId)
              throw new FleetError("fleet.stop_order_conflict");
            run.currentStopId = stop.id;
            run.phase =
              stop.kind === "pickup"
                ? "at_pickup"
                : stop.kind === "delivery"
                  ? "at_delivery"
                  : "returning";
          } else if (body.action === "depart_stop") {
            if (body.stopId !== run.currentStopId)
              throw new FleetError("fleet.stop_order_conflict");
            const stop = run.stops.find((s) => s.id === body.stopId)!;
            if (
              stop.kind === "pickup" &&
              !run.loads.some((l) => l.pickupStopId === stop.id)
            )
              throw new FleetError("fleet.load_required");
            if (
              stop.kind === "delivery" &&
              run.loads.some((l) => !l.deliveredAt)
            )
              throw new FleetError("fleet.delivery_required");
            run.visitedStopIds.push(stop.id);
            run.currentStopId = null;
            run.phase = "traveling_to_next_stop";
          } else if (body.action === "record_load") {
            if (
              !body.loadId ||
              !body.commodity ||
              !body.quantity ||
              !body.unit ||
              !body.manifestReference
            )
              throw new FleetError("fleet.load_fields_required", 400);
            if (!checkFleetManifestRequirements(run.operationalProfile, body.manifestValues)) throw new FleetError("fleet.load_fields_required", 400);
            if (run.loads.some((l) => l.id === body.loadId))
              throw new FleetError("fleet.load_exists");
            if (run.loads.length >= 100)
              throw new FleetError("fleet.store_capacity_reached");
            run.loads.push({
              id: body.loadId,
              manifestValues: body.manifestValues,
              pickupStopId: run.currentStopId!,
              deliveryStopId: null,
              commodity: body.commodity,
              quantity: body.quantity,
              unit: body.unit,
              manifestReference: body.manifestReference,
              deliveryReference: null,
              recordedByUserId: actor.userId,
              recordedAt: new Date().toISOString(),
              deliveredAt: null,
              source: "user_report",
            });
            run.phase = "loading";
          } else if (body.action === "record_delivery") {
            const load = run.loads.find((l) => l.id === body.loadId);
            if (!load || load.deliveredAt || !body.deliveryReference)
              throw new FleetError("fleet.delivery_fields_required", 400);
            load.deliveryStopId = run.currentStopId!;
            load.deliveryReference = body.deliveryReference;
            load.deliveredAt = new Date().toISOString();
            run.phase = "unloading";
          } else if (body.action === "submit_closeout") {
            run.status = "submitted_for_review";
            run.phase = null;
          } else if (body.action === "review") {
            if (!body.decision || !body.reason)
              throw new FleetError("fleet.review_fields_required", 400);
            run.status =
              body.decision === "accept" ? "completed" : "in_progress";
            run.phase = null;
          } else {
            if (body.action === "reassign") {
              run.driverUserId = body.driverUserId ?? run.driverUserId;
              run.vehicleAssetId = body.vehicleAssetId ?? run.vehicleAssetId;
              if (body.trailerAssetId !== undefined)
                run.trailerAssetId = body.trailerAssetId;
              run.status = "draft";
            }
            await eligible(state, client, run);
            if (body.action === "dispatch") run.status = "dispatched";
          }
          run.version++;
          run.events.push({
            id: randomUUID(),
            operationId: body.operationId,
            type: body.action,
            actorUserId: actor.userId,
            recordedAt: new Date().toISOString(),
            ...(body.capturedAt ? { capturedAt: body.capturedAt } : {}),
            source: "user_report",
            details: {
              ...(maintenanceIds.length ? { maintenanceIds } : {}),
              ...(body.reason ? { reason: body.reason } : {}),
              ...(body.notes ? { notes: body.notes } : {}),
              ...(body.decision ? { decision: body.decision } : {}),
              ...(body.action === "reassign" ? { priorAssignment } : {}),
            },
          });
          state.operations.push({
            id: body.operationId,
            actorUserId: actor.userId,
            fingerprint,
            runId: run.id,
            result: structuredClone(run),
          });
          return project(state, actor, run);
        },
      ),
  };
}
