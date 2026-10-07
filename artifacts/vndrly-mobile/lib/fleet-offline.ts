import { FleetActionInputSchema, type FleetActionInput, type FleetOverview } from "@workspace/api-zod";
import { z } from "zod/v4";

export type FleetOfflineScope = { userId: number; companyId: number; membershipId: number | null };
export type FleetQueuedAction = { runId: string; input: FleetActionInput; capturedAt: string; state: "unsynced" | "conflict" | "revoked"; message?: string };
export type FleetOfflineDocument = { version: 1; scope: FleetOfflineScope; overview: FleetOverview | null; cachedAt: string | null; actions: FleetQueuedAction[] };
export type FleetOfflineStore = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; removeItem(key: string): Promise<void> };
export function fleetOfflineByteLength(value: string) { return [...value].reduce((bytes, char) => { const code = char.codePointAt(0)!; return bytes + (code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4); }, 0); }
export function fleetOfflineKey(scope: FleetOfflineScope) { return `vndrly.fleet.${scope.userId}.${scope.companyId}.${scope.membershipId ?? 0}`; }
export function createFleetOfflineStore(store: FleetOfflineStore) {
  async function read(scope: FleetOfflineScope): Promise<FleetOfflineDocument> {
    const raw = await store.getItem(fleetOfflineKey(scope));
    if (!raw) return { version: 1, scope, overview: null, cachedAt: null, actions: [] };
    const value = JSON.parse(raw) as FleetOfflineDocument;
    if (value.version !== 1 || fleetOfflineKey(value.scope) !== fleetOfflineKey(scope)) throw new Error("Fleet offline account mismatch.");
    for (const action of value.actions) {
      z.uuid().parse(action.runId); FleetActionInputSchema.parse(action.input); z.iso.datetime().parse(action.capturedAt);
      if (!["unsynced", "conflict", "revoked"].includes(action.state)) throw new Error("Fleet queue state is invalid.");
    }
    return value;
  }
  async function write(value: FleetOfflineDocument) { await store.setItem(fleetOfflineKey(value.scope), JSON.stringify(value)); }
  const api = {
    read,
    clear: (scope: FleetOfflineScope) => store.removeItem(fleetOfflineKey(scope)),
    async cache(scope: FleetOfflineScope, overview: FleetOverview) {
      if (overview.companyId !== scope.companyId) throw new Error("Fleet company mismatch.");
      const value = await read(scope);
      const ownActions = new Set(["acknowledge", "inspect", "start", "pause", "resume", "arrive_stop", "depart_stop", "record_load", "record_delivery", "record_fuel", "record_meter", "submit_closeout"]);
      value.overview = { ...overview, runs: overview.runs.filter(run => run.driverUserId === scope.userId).map(run => ({ ...run, allowedActions: run.allowedActions.filter(action => ownActions.has(action)) })), observations: [], capabilities: { ...overview.capabilities, canDispatch: false, canManage: false, canSetup: false }, fleets: [], roles: ["driver"] };
      value.cachedAt = new Date().toISOString(); await write(value);
    },
    async enqueue(scope: FleetOfflineScope, action: FleetQueuedAction) {
      z.uuid().parse(action.runId); FleetActionInputSchema.parse(action.input); z.iso.datetime().parse(action.capturedAt);
      const value = await read(scope);
      const existing = value.actions.find(item => item.input.operationId === action.input.operationId);
      if (existing) return existing;
      if (value.actions.some(item => item.runId === action.runId)) throw new Error("Synchronize the existing unsynced action for this run first.");
      if (value.actions.length >= 20) throw new Error("Fleet offline queue is full.");
      value.actions.push(action); await write(value); return action;
    },
    async resolve(scope: FleetOfflineScope, operationId: string, outcome: "accepted" | "conflict" | "revoked", message?: string) {
      const value = await read(scope);
      if (outcome === "accepted") value.actions = value.actions.filter(item => item.input.operationId !== operationId);
      else value.actions = value.actions.map(item => item.input.operationId === operationId ? { ...item, state: outcome, message } : item);
      await write(value);
    },
    async discardRefused(scope: FleetOfflineScope, operationId: string) {
      const value = await read(scope);
      const item = value.actions.find(action => action.input.operationId === operationId);
      if (item?.state === "unsynced") throw new Error("Verify the unsynced outcome before discarding this entry.");
      value.actions = value.actions.filter(action => action.input.operationId !== operationId); await write(value);
    },
  };
  let pending: Promise<unknown> = Promise.resolve();
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = pending.then(operation, operation);
    pending = result.catch(() => undefined);
    return result;
  }
  return {
    exclusive: <T>(operation: () => Promise<T>) => serial(operation),
    read: (scope: FleetOfflineScope) => serial(() => api.read(scope)),
    clear: (scope: FleetOfflineScope) => serial(() => api.clear(scope)),
    cache: (scope: FleetOfflineScope, overview: FleetOverview) => serial(() => api.cache(scope, overview)),
    enqueue: (scope: FleetOfflineScope, action: FleetQueuedAction) => serial(() => api.enqueue(scope, action)),
    resolve: (scope: FleetOfflineScope, operationId: string, outcome: "accepted" | "conflict" | "revoked", message?: string) => serial(() => api.resolve(scope, operationId, outcome, message)),
    discardRefused: (scope: FleetOfflineScope, operationId: string) => serial(() => api.discardRefused(scope, operationId)),
  };
}
