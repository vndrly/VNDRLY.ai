import { FleetHomeProjectionSchema, type FleetCapability, type FleetHomeProjection, type FleetOverview, type FleetResources } from "@workspace/api-zod";
import { databaseFleetRepository, FleetError } from "./fleet-repository";
import { createFleetService, type FleetActor } from "./fleet-ops";
import { createFleetYardOperations } from "./fleet-yard";
import { resolveFleetCapabilities } from "./fleet-mobile-permissions";
import { readFleetComplianceScore } from "./fleet-compliance-score";

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
  map(actor: FleetActor): Promise<unknown>;
  complianceSummary(actor: FleetActor): Promise<{ status?: string; score?: number }>;
  compliance(actor: FleetActor): Promise<unknown>;
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
  map: (actor) => fleet.mapContext(actor),
  complianceSummary: (actor) => fleet.readFleetComplianceScorePreview(actor),
  compliance: (actor) => readFleetComplianceScore(actor, fleet),
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
      result.push({ kind: "review_closeout", label: "Review closeout", runId: run.id });
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
      const [overview, yardOrders, compliance, assets, map] = await Promise.allSettled([
        source.overview(projectionActor),
        permitted(capabilities, "yard") ? source.yardOrders(projectionActor) : Promise.resolve({ orders: [] }),
        permitted(capabilities, "compliance") ? source.complianceSummary(projectionActor) : Promise.resolve(null),
        permitted(capabilities, "assets") ? source.resources(projectionActor) : Promise.resolve(null),
        permitted(capabilities, "map") ? source.map(projectionActor) : Promise.resolve(null),
      ]);
      const runs = overview.status === "fulfilled" ? overview.value.runs.filter((run) => capabilities.has("admin") || capabilities.has("dispatch") || capabilities.has("office") || run.driverUserId === actor.userId) : [];
      const orders = yardOrders.status === "fulfilled" ? yardOrders.value.orders : [];
      const ownedDrivers = new Set(runs.map((run) => run.driverUserId));
      const independent = capabilities.has("driver") && (capabilities.has("admin") || capabilities.has("dispatch") || capabilities.has("self_dispatch")) && [...ownedDrivers].every((id) => id === actor.userId);
      const priorities = actions(actor, capabilities, runs, orders);
      const resourceData = assets.status === "fulfilled" && assets.value && "drivers" in assets.value ? assets.value : null;
      const assignedDriverIds = new Set(runs.filter((run) => !["completed", "cancelled"].includes(run.status)).map((run) => run.driverUserId));
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
        drivers: (resourceData?.drivers ?? []).slice(0, 100).map(driver => ({ userId: driver.userId, title: driver.name, detail: driverCompliance(driver).label, status: assignedDriverIds.has(driver.userId) ? "unavailable" as const : "available" as const, compliance: driverCompliance(driver).status })),
        equipment: [...(resourceData?.equipment ?? [])].sort((left, right) => {
          const rank = (asset: (NonNullable<typeof resourceData>["equipment"])[number]) => asset.status === "checked_out" ? 0 : asset.dispatchable ? 1 : 2;
          return rank(left) - rank(right) || left.name.localeCompare(right.name);
        }).slice(0, 200).map(asset => ({ id: asset.id, title: asset.name, detail: `${asset.category} · ${asset.status.replaceAll("_", " ")}`, status: asset.status === "checked_out" ? "in_use" as const : asset.dispatchable ? "available" as const : "unavailable" as const })),
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
        availableDrivers: resourceData ? resourceData.drivers.filter((driver) => !assignedDriverIds.has(driver.userId)).length : null,
        yardInventory: resourceData ? resourceData.equipment.filter((asset) => asset.dispatchable).length : null,
        equipmentInUse: resourceData ? resourceData.equipment.filter((asset) => asset.status === "checked_out").length : null,
        equipmentAvailable: resourceData ? resourceData.equipment.filter((asset) => asset.status !== "checked_out" && asset.dispatchable).length : null,
        equipmentUnavailable: resourceData ? resourceData.equipment.filter((asset) => asset.status !== "checked_out" && !asset.dispatchable).length : null,
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
