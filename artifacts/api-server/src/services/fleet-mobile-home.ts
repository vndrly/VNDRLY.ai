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

type Run = Pick<FleetOverview["runs"][number], "id" | "status" | "driverUserId">;
type Overview = Pick<FleetOverview, "companyId" | "enabled" | "fleets" | "generatedAt"> & { runs: Run[] };
type Source = {
  capabilities(actor: FleetActor): Promise<ReadonlySet<FleetCapability>>;
  overview(actor: FleetActor): Promise<Overview>;
  yardOrders(actor: FleetActor): Promise<{ orders: Array<{ id: string; status: string; assignedToUserId: number | null; runId: string | null }> }>;
  resources(actor: FleetActor): Promise<Pick<FleetResources, "drivers" | "equipment"> | { custody: unknown[] }>;
  map(actor: FleetActor): Promise<unknown>;
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
  for (const order of orders) if (c.has("yard") && order.assignedToUserId === actor.userId && ["assigned", "in_progress"].includes(order.status))
    result.push({ kind: "report_yard_order", label: "Report Yard Order", ...(order.runId ? { runId: order.runId } : {}) });
  // The same employee's Dispatch, Yard, and Driver handoffs belong to one job.
  return [...new Map(result.map((item) => [item.runId ?? `${item.kind}:${result.indexOf(item)}`, item])).values()].slice(0, 50);
}

/** Each module uses its own canonical read and returns a scoped recovery result. */
export function createFleetHomeReader(source: Source = canonical) {
  return async function readFleetHomeModule(actor: FleetActor, module: FleetHomeModule): Promise<FleetModuleResult> {
    const capabilities = await source.capabilities(actor);
    if (!permitted(capabilities, module)) throw new FleetError("fleet.permission_denied", 403);
    if (module === "summary") {
      const [overview, yardOrders, compliance, assets, map] = await Promise.allSettled([
        source.overview(actor),
        permitted(capabilities, "yard") ? source.yardOrders(actor) : Promise.resolve({ orders: [] }),
        permitted(capabilities, "compliance") ? source.compliance(actor) : Promise.resolve(null),
        permitted(capabilities, "assets") ? source.resources(actor) : Promise.resolve(null),
        permitted(capabilities, "map") ? source.map(actor) : Promise.resolve(null),
      ]);
      if (overview.status === "rejected") return failure(module, overview.reason);
      const runs = overview.value.runs.filter((run) => capabilities.has("admin") || capabilities.has("dispatch") || capabilities.has("office") || run.driverUserId === actor.userId);
      const orders = yardOrders.status === "fulfilled" ? yardOrders.value.orders : [];
      const ownedDrivers = new Set(runs.map((run) => run.driverUserId));
      const independent = capabilities.has("driver") && (capabilities.has("admin") || capabilities.has("dispatch") || capabilities.has("self_dispatch")) && [...ownedDrivers].every((id) => id === actor.userId);
      const priorities = actions(actor, capabilities, runs, orders);
      const moduleStates: FleetHomeProjection["moduleStates"] = [
        { module: "dispatch", state: permitted(capabilities, "dispatch") ? runs.length ? "ready" : "empty" : "empty" },
        { module: "yard", state: permitted(capabilities, "yard") ? yardOrders.status === "rejected" ? "unavailable" : orders.length ? "ready" : "empty" : "empty" },
        { module: "assets", state: permitted(capabilities, "assets") ? assets.status === "rejected" ? "unavailable" : "ready" : "empty" },
        { module: "map", state: permitted(capabilities, "map") ? map.status === "rejected" ? "unavailable" : "ready" : "empty" },
        { module: "history", state: runs.length ? "ready" : "empty" },
        { module: "compliance", state: permitted(capabilities, "compliance") ? compliance.status === "rejected" ? "unavailable" : (compliance.value as { status?: string } | null)?.status === "red" ? "warning" : "ready" : "empty" },
      ];
      const data = FleetHomeProjectionSchema.parse({ companyId: actor.companyId, userId: actor.userId, mode: independent ? "my_fleet_day" : "coordinated", capabilities: [...capabilities], nextAction: priorities[0] ?? null, priorities, warnings: [], moduleStates });
      return { module, state: moduleStates.some((item) => item.state === "unavailable" || item.state === "warning") ? "warning" : priorities.length ? "ready" : "empty", data };
    }
    try {
      if (module === "yard") { const data = await source.yardOrders(actor); return { module, state: data.orders.length ? "ready" : "empty", data }; }
      if (module === "assets") { const data = await source.resources(actor); return { module, state: ("equipment" in data ? data.equipment.length : data.custody.length) ? "ready" : "empty", data }; }
      if (module === "map") return { module, state: "ready", data: await source.map(actor) };
      if (module === "compliance") { const data = await source.compliance(actor); return { module, state: (data as { status?: string }).status === "red" ? "warning" : "ready", data }; }
      const overview = await source.overview(actor);
      const runs = module === "driver" || capabilities.has("self_dispatch") && !capabilities.has("dispatch") && !capabilities.has("admin") ? overview.runs.filter((run) => run.driverUserId === actor.userId) : overview.runs;
      const selected = module === "office" ? runs.filter((run) => run.status === "submitted_for_review") : module === "dispatch" ? runs.filter((run) => run.status !== "completed" && run.status !== "cancelled") : runs;
      return { module, state: selected.length ? "ready" : "empty", data: { runs: selected, generatedAt: overview.generatedAt } };
    } catch (error) { return failure(module, error); }
  };
}

export const readFleetHomeModule = createFleetHomeReader();
