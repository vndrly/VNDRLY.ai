import { FleetHomeProjectionSchema, type FleetCapability, type FleetHomeProjection, type FleetOverview, type FleetResources } from "@workspace/api-zod";
import { databaseFleetRepository, FleetError } from "./fleet-repository";
import { createFleetService, type FleetActor } from "./fleet-ops";
import { createFleetYardOperations } from "./fleet-yard";
import { resolveFleetCapabilities } from "./fleet-mobile-permissions";
import { readFleetComplianceScore } from "./fleet-compliance-score";
import { pool } from "@workspace/db";

export type FleetHomeModule = "summary" | "dispatch" | "yard" | "driver" | "office" | "assets" | "map" | "history" | "compliance";
export type FleetModuleResult = {
  module: FleetHomeModule;
  state: "ready" | "empty" | "warning" | "unavailable";
  data?: unknown;
  error?: { code: string; status: number; recovery: { module: FleetHomeModule; reloadCanonical: boolean; retainedWork: "unknown"; retryPath: string } };
};

type Run = Pick<FleetOverview["runs"][number], "id" | "status" | "driverUserId"> & Partial<Pick<FleetOverview["runs"][number], "title" | "linkedTicketId" | "stops" | "labels">>;
type Overview = Pick<FleetOverview, "companyId" | "enabled" | "fleets" | "generatedAt"> & { runs: Run[] };
type Source = {
  capabilities(actor: FleetActor): Promise<ReadonlySet<FleetCapability>>;
  overview(actor: FleetActor): Promise<Overview>;
  yardOrders(actor: FleetActor): Promise<{ orders: Array<{ id: string; status: string; assignedToUserId: number | null; runId: string | null; outcome?: string | null; notes?: string; requestedAssetIds?: string[] }> }>;
  resources(actor: FleetActor): Promise<Pick<FleetResources, "drivers" | "equipment"> | { custody: unknown[] }>;
  custody(actor: FleetActor): Promise<{ custody: Array<{ observation: { assetId: string; method: string; observedAt: string; observedByUserId: number; yardId: string | null; runId: string | null } }> }>;
  yards(actor: FleetActor): Promise<{ yards: Array<{ id: string; name: string }> }>;
  map(actor: FleetActor): Promise<unknown>;
  complianceSummary(actor: FleetActor): Promise<{ status?: string; score?: number }>;
  compliance(actor: FleetActor): Promise<unknown>;
  driverShiftStates?(actor: FleetActor, driverUserIds: number[]): Promise<Map<number, "on_shift" | "on_break" | "off_shift">>;
  userNames?(actor: FleetActor, userIds: number[]): Promise<Map<number, string>>;
};

const fleet = createFleetService(databaseFleetRepository);
const yard = createFleetYardOperations(databaseFleetRepository);
const canonical: Source = {
  capabilities: (actor) => resolveFleetCapabilities(actor, actor.companyId),
  overview: (actor) => fleet.overview({ ...actor, runPage: { limit: 50 } }),
  yardOrders: (actor) => yard.yardOrders(actor),
  resources: async (actor) => {
    const capabilities = await resolveFleetCapabilities(actor, actor.companyId);
    return capabilities.has("admin") || capabilities.has("dispatch") ? fleet.resources(actor) : yard.custody(actor);
  },
  custody: (actor) => yard.custody(actor, { limit: 100 }),
  yards: (actor) => yard.yards(actor, { limit: 100 }),
  map: (actor) => fleet.mapContext(actor),
  complianceSummary: (actor) => fleet.readFleetComplianceScorePreview(actor),
  compliance: (actor) => readFleetComplianceScore(actor, fleet),
  driverShiftStates: async (actor, driverUserIds) => {
    if (!driverUserIds.length) return new Map();
    const result = await pool.query(
      `SELECT (tool_output->>'workerUserId')::int AS user_id,
              tool_output->'summary'->>'state' AS state
         FROM (SELECT DISTINCT ON (tool_output->>'workerUserId') tool_output,id
                 FROM assistant_action_audit
                WHERE vendor_id=$1 AND partner_id IS NULL AND target_type='workday'
                  AND (tool_output->>'workerUserId')::int = ANY($2::int[])
                ORDER BY tool_output->>'workerUserId',id DESC) latest`,
      [actor.companyId, driverUserIds],
    );
    return new Map(result.rows.map((row) => [Number(row.user_id), row.state === "on_shift" ? "on_shift" : row.state === "on_break" ? "on_break" : "off_shift"]));
  },
  userNames: async (actor, userIds) => {
    if (!userIds.length) return new Map();
    const result = await pool.query(
      `SELECT DISTINCT u.id,u.display_name
         FROM users u
         JOIN user_org_memberships m ON m.user_id=u.id
        WHERE m.vendor_id=$1 AND m.org_type='vendor'
          AND u.id=ANY($2::int[]) AND u.suspended_at IS NULL`,
      [actor.companyId, userIds],
    );
    return new Map(result.rows.map((row) => [Number(row.id), String(row.display_name)]));
  },
};

function permitted(c: ReadonlySet<FleetCapability>, module: FleetHomeModule) {
  const admin = c.has("admin");
  switch (module) {
    case "summary": case "history": return c.size > 0;
    case "dispatch": return admin || c.has("dispatch") || c.has("self_dispatch");
    case "yard": return admin || c.has("dispatch") || c.has("yard") || c.has("self_dispatch");
    case "driver": return c.has("driver");
    case "office": return admin || c.has("office");
    case "assets": return admin || c.has("dispatch") || c.has("yard");
    case "map": return admin || c.has("dispatch");
    case "compliance": return admin || c.has("office") || c.has("dispatch");
  }
}

function failure(module: FleetHomeModule, error: unknown): FleetModuleResult {
  const status = error instanceof FleetError ? error.status : typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : 503;
  const code = error instanceof FleetError ? error.code : typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "fleet.module_unavailable";
  return { module, state: "unavailable", error: { code, status, recovery: { module, reloadCanonical: status === 409, retainedWork: "unknown", retryPath: `/api/fleet/home?module=${module}` } } };
}

function actions(actor: FleetActor, c: ReadonlySet<FleetCapability>, runs: readonly Run[], orders: readonly { id: string; status: string; assignedToUserId: number | null; runId: string | null }[]): FleetHomeProjection["priorities"] {
  const result: FleetHomeProjection["priorities"] = [];
  for (const run of runs) {
    if (c.has("driver") && run.driverUserId === actor.userId && ["dispatched", "acknowledged", "in_progress"].includes(run.status)) {
      result.push({ kind: run.status === "in_progress" ? "continue_run" : "start_run", label: run.status === "in_progress" ? "Continue run" : "Start run", runId: run.id });
    } else if ((c.has("admin") || c.has("dispatch") || c.has("self_dispatch") && run.driverUserId === actor.userId) && run.status === "draft") {
      result.push({ kind: "prepare_detail", label: "Prepare Detail", runId: run.id });
    } else if ((c.has("admin") || c.has("office")) && run.status === "submitted_for_review") {
      result.push({ kind: "review_closeout", label: "Close Ticket for Review", runId: run.id });
    }
  }
  for (const order of orders) if ((c.has("yard") || c.has("self_dispatch") || c.has("admin")) && order.assignedToUserId === actor.userId && ["assigned", "in_progress"].includes(order.status))
    result.push({ kind: "report_yard_order", label: "Report Yard Order", yardOrderId: order.id, ...(order.runId ? { runId: order.runId } : {}) });
  // Keep the active run first. A Yard follow-up for that run remains separately actionable.
  return [...new Map(result.map((item) => [item.yardOrderId ?? `${item.kind}:${item.runId}`, item])).values()].slice(0, 50);
}

/** Each module uses its own canonical read and returns a scoped recovery result. */
export function createFleetHomeReader(source: Source = canonical) {
  return async function readFleetHomeModule(actor: FleetActor, module: FleetHomeModule): Promise<FleetModuleResult> {
    const capabilities = await source.capabilities(actor);
    const projectionActor: FleetActor = { ...actor, repositoryAccess: "read" };
    if (!permitted(capabilities, module)) throw new FleetError("fleet.permission_denied", 403);
    if (module === "summary") {
      const [overview, yardOrders, compliance, assets, map, custody, yards] = await Promise.allSettled([
        source.overview(projectionActor),
        permitted(capabilities, "yard") ? source.yardOrders(projectionActor) : Promise.resolve({ orders: [] }),
        permitted(capabilities, "compliance") ? source.complianceSummary(projectionActor) : Promise.resolve(null),
        permitted(capabilities, "assets") ? source.resources(projectionActor) : Promise.resolve(null),
        permitted(capabilities, "map") ? source.map(projectionActor) : Promise.resolve(null),
        permitted(capabilities, "assets") ? source.custody(projectionActor) : Promise.resolve({ custody: [] }),
        permitted(capabilities, "assets") ? source.yards(projectionActor) : Promise.resolve({ yards: [] }),
      ]);
      const runs = overview.status === "fulfilled" ? overview.value.runs.filter((run) => capabilities.has("admin") || capabilities.has("dispatch") || capabilities.has("office") || run.driverUserId === actor.userId) : [];
      const orders = yardOrders.status === "fulfilled" ? yardOrders.value.orders : [];
      const ownedDrivers = new Set(runs.map((run) => run.driverUserId));
      const independent = capabilities.has("driver") && (capabilities.has("admin") || capabilities.has("dispatch") || capabilities.has("self_dispatch")) && [...ownedDrivers].every((id) => id === actor.userId);
      const priorities = actions(actor, capabilities, runs, orders);
      const resourceData = assets.status === "fulfilled" && assets.value && "drivers" in assets.value ? assets.value : null;
      const driverShiftStates = source.driverShiftStates && resourceData
        ? await source.driverShiftStates(projectionActor, resourceData.drivers.map(driver => driver.userId)).catch(() => new Map<number, "on_shift" | "on_break" | "off_shift">())
        : new Map<number, "on_shift" | "on_break" | "off_shift">();
      const custodyData = custody.status === "fulfilled" ? custody.value.custody : [];
      const yardData = yards.status === "fulfilled" ? yards.value.yards : [];
      const custodyUserNames = source.userNames
        ? await source.userNames(projectionActor, [...new Set(custodyData.map(row => row.observation.observedByUserId))]).catch(() => new Map<number, string>())
        : new Map<number, string>();
      const activeDriverRuns = new Map(runs.filter((run) => ["dispatched", "acknowledged", "in_progress"].includes(run.status) && run.driverUserId != null).map((run) => [run.driverUserId!, run]));
      const complianceData = compliance.status === "fulfilled" ? compliance.value : null;
      const orderFor = (runId: string) => orders.find(order => order.runId === runId);
      const runTitle = (run: Run) => run.linkedTicketId ? `Ticket #${run.linkedTicketId} · ${run.title ?? "Fleet Run"}` : run.title ?? `Fleet Run ${run.id.slice(0, 8)}`;
      const runRoute = (run: Run) => {
        const stops = run.stops ?? [], label = (index: number) => stops[index]?.destination?.name ?? run.labels?.sites.find(site => site.siteId === stops[index]?.siteId)?.name ?? (stops[index]?.siteId ? `Site ${stops[index]?.siteId}` : "Route pending");
        return `${label(0)} → ${label(Math.max(0, stops.length - 1))}`;
      };
      const driverState = (run: Run) => run.status === "draft" ? "Assigned" : run.status === "dispatched" ? "Awaiting driver" : run.status === "acknowledged" ? "Driver ready" : run.status === "in_progress" ? "In progress" : run.status.replaceAll("_", " ");
      const historyRuns = runs.filter(run => ["submitted_for_review", "completed", "cancelled"].includes(run.status)).slice(0, 50);
      const driverCompliance = (driver: NonNullable<typeof resourceData>["drivers"][number]) => {
        if (!driver.cdlRecorded) return { status: "red" as const, label: "CDL record missing" };
        if (!driver.cdlExpirationDate) return { status: "amber" as const, label: "CDL expiration not recorded" };
        const days = (new Date(`${driver.cdlExpirationDate}T23:59:59Z`).getTime() - Date.now()) / 86400000;
        return days < 0 ? { status: "red" as const, label: `CDL expired ${driver.cdlExpirationDate}` } : days <= 60 ? { status: "amber" as const, label: `CDL expires ${driver.cdlExpirationDate}` } : { status: "green" as const, label: `CDL current through ${driver.cdlExpirationDate}` };
      };
      const previews: FleetHomeProjection["previews"] = {
        yard: orders.filter(order => !["completed", "cancelled"].includes(order.status) && (order.status !== "reported" || order.outcome !== "ready")).slice(0, 50).map(order => ({ id: order.id, runId: order.runId, title: order.notes || `Yard Order ${order.id.slice(0, 8)}`, detail: `${order.requestedAssetIds?.length ?? 0} components · ${order.status.replaceAll("_", " ")}`, status: order.outcome?.replaceAll("_", " ") ?? (order.assignedToUserId ? "Yard assigned" : "Awaiting assignment"), danger: order.outcome === "unable_to_complete" || order.outcome === "needs_attention" })),
        ready: runs.filter(run => run.status === "draft" && (!orderFor(run.id) || orderFor(run.id)?.outcome === "ready")).slice(0, 50).map(run => ({ id: run.id, title: runTitle(run), detail: `${runRoute(run)} · Yard: ${orderFor(run.id)?.outcome?.replaceAll("_", " ") ?? "No Yard order"}`, status: `Driver: ${driverState(run)}` })),
        active: runs.filter(run => ["dispatched", "acknowledged", "in_progress"].includes(run.status)).slice(0, 50).map(run => ({ id: run.id, title: runTitle(run), detail: runRoute(run), status: driverState(run) })),
        history: historyRuns.map(run => ({ id: run.id, title: runTitle(run), detail: runRoute(run), status: run.status.replaceAll("_", " ") })),
        drivers: (resourceData?.drivers ?? []).map(driver => {
          const activeRun = activeDriverRuns.get(driver.userId), shift = driverShiftStates.get(driver.userId) ?? "off_shift";
          const operationalStatus = activeRun ? "on_run" as const : shift === "on_shift" ? "available" as const : shift === "off_shift" ? "off_shift" as const : "unavailable" as const;
          const operationalLabel = activeRun ? `On Run · ${activeRun.linkedTicketId ? `Ticket #${activeRun.linkedTicketId}` : runTitle(activeRun)}` : operationalStatus === "available" ? "Available" : operationalStatus === "off_shift" ? "Off Shift" : "Unavailable";
          return { userId: driver.userId, title: driver.name, detail: driverCompliance(driver).label, status: operationalStatus === "available" ? "available" as const : "unavailable" as const, compliance: driverCompliance(driver).status, operationalStatus, operationalLabel, ...(activeRun ? { runId: activeRun.id, ticketLabel: activeRun.linkedTicketId ? `Ticket #${activeRun.linkedTicketId}` : runTitle(activeRun) } : {}) };
        }).sort((left, right) => {
          const rank = { on_run: 0, available: 1, off_shift: 2, unavailable: 3 } as const;
          return rank[left.operationalStatus] - rank[right.operationalStatus] || left.title.localeCompare(right.title);
        }).slice(0, 100),
        equipment: [...(resourceData?.equipment ?? [])].sort((left, right) => {
          const rank = (asset: (NonNullable<typeof resourceData>["equipment"])[number]) => asset.status === "checked_out" ? 0 : asset.dispatchable ? 1 : 2;
          return rank(left) - rank(right) || left.name.localeCompare(right.name);
        }).slice(0, 200).map(asset => {
          const last = custodyData.find(row => row.observation.assetId === asset.id)?.observation;
          const verified = last?.method === "gate_scan" || last?.method === "gps_geofence";
          const yardName = last?.yardId ? yardData.find(item => item.id === last.yardId)?.name : null;
          const locationStatus = !last ? "unavailable" as const : verified ? "verified" as const : "last_known" as const;
          const location = !last ? "No location available" : `${verified ? "Verified" : "Last known"}: ${yardName ?? (last.runId ? "Active Run" : "Location recorded")}`;
          const lastRun = last?.runId ? runs.find(run => run.id === last.runId) : undefined;
          const lastDriver = lastRun?.driverUserId == null ? undefined : resourceData?.drivers.find(driver => driver.userId === lastRun.driverUserId)?.name;
          const observer = last ? custodyUserNames.get(last.observedByUserId) ?? resourceData?.drivers.find(driver => driver.userId === last.observedByUserId)?.name : undefined;
          const custodyName = verified ? observer : lastDriver ?? (last?.method === "driver_app" ? observer : undefined) ?? asset.currentHolderName ?? undefined;
          const custodyLabel = !last ? "Unknown" : verified ? `${custodyName ?? "Unknown"} (verified yard check-in)` : `${custodyName ?? "Unknown"} (last driver)`;
          const rigging = /trailer|vacuum|frac|tank|pump|dolly|rig/i.test(`${asset.category} ${asset.name}`);
          const status = asset.status === "checked_out" ? "in_use" as const : asset.dispatchable ? "available" as const : "unavailable" as const;
          return { id: asset.id, title: asset.name, detail: `${asset.category.replaceAll("_", " ")} · ${status.replaceAll("_", " ")} · ${location} · Custody: ${custodyLabel}`, status, group: rigging ? "rigging" as const : "vehicle" as const, locationStatus, custodyLabel };
        }),
        compliance: [
          ...(resourceData?.drivers ?? []).map(driver => ({ driver, compliance: driverCompliance(driver) })).filter(item => item.compliance.status !== "green").map(item => ({ id: `driver-${item.driver.userId}`, title: item.driver.name, detail: item.compliance.label, status: item.compliance.status as "amber" | "red", target: "driver" as const, targetId: String(item.driver.userId) })),
          ...(resourceData?.equipment ?? []).filter(asset => !asset.dispatchable).map(asset => ({ id: `equipment-${asset.id}`, title: asset.name, detail: `${asset.category} · ${asset.status.replaceAll("_", " ")} · review tag, insurance, and safety records`, status: "amber" as const, target: "equipment" as const, targetId: asset.id })),
        ].slice(0, 100),
        historyCapped: historyRuns.length === 50,
      };
      const metrics: FleetHomeProjection["metrics"] = {
        yardOrders: yardOrders.status === "fulfilled" ? orders.filter((order) => !["completed", "cancelled"].includes(order.status) && (order.status !== "reported" || (order as { outcome?: string | null }).outcome !== "ready")).length : null,
        awaitingDispatch: overview.status === "fulfilled" ? runs.filter((run) => run.status === "draft" && (() => { const order = orders.find(item => item.runId === run.id) as ({ outcome?: string | null } | undefined); return !order || order.outcome === "ready"; })()).length : null,
        activeRuns: overview.status === "fulfilled" ? runs.filter((run) => ["dispatched", "acknowledged", "in_progress"].includes(run.status)).length : null,
        runHistory: overview.status === "fulfilled" ? runs.filter((run) => ["submitted_for_review", "completed", "cancelled"].includes(run.status)).length : null,
        availableDrivers: resourceData ? resourceData.drivers.filter((driver) => !activeDriverRuns.has(driver.userId) && driverShiftStates.get(driver.userId) === "on_shift").length : null,
        yardInventory: resourceData ? resourceData.equipment.filter((asset) => asset.dispatchable).length : null,
        equipmentInUse: resourceData ? resourceData.equipment.filter((asset) => asset.status === "checked_out").length : null,
        equipmentAvailable: resourceData ? resourceData.equipment.filter((asset) => asset.status !== "checked_out" && asset.dispatchable).length : null,
        equipmentUnavailable: resourceData ? resourceData.equipment.filter((asset) => asset.status !== "checked_out" && !asset.dispatchable).length : null,
        complianceExpiringSoon: previews.compliance?.filter(item => item.status === "amber").length ?? null,
        complianceExpiredOrMissing: previews.compliance?.filter(item => item.status === "red").length ?? null,
        complianceScore: typeof complianceData?.score === "number" ? complianceData.score : null,
        complianceStatus: complianceData?.status === "red" || complianceData?.status === "amber" || complianceData?.status === "green" ? complianceData.status : null,
      };
      const moduleStates: FleetHomeProjection["moduleStates"] = [
        { module: "dispatch", state: permitted(capabilities, "dispatch") ? overview.status === "rejected" ? "unavailable" : runs.length ? "ready" : "empty" : "empty" },
        { module: "yard", state: permitted(capabilities, "yard") ? yardOrders.status === "rejected" ? "unavailable" : orders.length ? "ready" : "empty" : "empty" },
        { module: "assets", state: permitted(capabilities, "assets") ? assets.status === "rejected" ? "unavailable" : "ready" : "empty" },
        { module: "map", state: permitted(capabilities, "map") ? map.status === "rejected" ? "unavailable" : "ready" : "empty" },
        { module: "history", state: overview.status === "rejected" ? "unavailable" : runs.length ? "ready" : "empty" },
        { module: "compliance", state: permitted(capabilities, "compliance") ? compliance.status === "rejected" ? "unavailable" : (compliance.value as { status?: string } | null)?.status === "red" ? "warning" : "ready" : "empty" },
      ];
      const data = FleetHomeProjectionSchema.parse({ companyId: actor.companyId, userId: actor.userId, mode: independent ? "my_fleet_day" : "coordinated", capabilities: [...capabilities], nextAction: priorities[0] ?? null, priorities, warnings: [], metrics, previews, moduleStates });
      return { module, state: moduleStates.some((item) => item.state === "unavailable" || item.state === "warning") ? "warning" : priorities.length ? "ready" : "empty", data };
    }
    try {
      if (module === "yard") { const data = await source.yardOrders(projectionActor); return { module, state: data.orders.length ? "ready" : "empty", data }; }
      if (module === "assets") { const data = await source.resources(projectionActor); return { module, state: ("equipment" in data ? data.equipment.length : data.custody.length) ? "ready" : "empty", data }; }
      if (module === "map") return { module, state: "ready", data: await source.map(projectionActor) };
      if (module === "compliance") { const data = await source.compliance(actor); return { module, state: (data as { status?: string }).status === "red" ? "warning" : "ready", data }; }
      const overview = await source.overview(projectionActor);
      const runs = module === "driver" || capabilities.has("self_dispatch") && !capabilities.has("dispatch") && !capabilities.has("admin") ? overview.runs.filter((run) => run.driverUserId === actor.userId) : overview.runs;
      const selected = module === "office" ? runs.filter((run) => run.status === "submitted_for_review") : module === "dispatch" ? runs.filter((run) => run.status !== "completed" && run.status !== "cancelled") : runs;
      return { module, state: selected.length ? "ready" : "empty", data: { runs: selected, generatedAt: overview.generatedAt } };
    } catch (error) { return failure(module, error); }
  };
}

export const readFleetHomeModule = createFleetHomeReader();
