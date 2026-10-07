export const FLEET_OFFLINE_MAX_ACTIONS = 64;
export const FLEET_OFFLINE_MAX_BYTES = 64 * 1024;
import { FleetActionInputSchema, type FleetActionInput, type FleetOverview } from "@workspace/api-zod";
import { z } from "zod/v4";

export type FleetOfflineScope = { userId: number; companyId: number; membershipId: number | null; sessionVersion?: number };
export type FleetQueueBase = { runId: string; companyId: number; driverUserId: number; vehicleAssetId: string; trailerAssetId: string | null; version: number };
export type FleetQueuedAction = { sessionVersion?: number; runId: string; base: FleetQueueBase; input: FleetActionInput; capturedAt: string; state: "unsynced" | "conflict" | "revoked"; message?: string };
export function fleetQueueBase(run: Pick<import("@workspace/api-zod").FleetRun, "id" | "companyId" | "driverUserId" | "vehicleAssetId" | "trailerAssetId" | "version">): FleetQueueBase { return { runId: run.id, companyId: run.companyId, driverUserId: run.driverUserId, vehicleAssetId: run.vehicleAssetId, trailerAssetId: run.trailerAssetId, version: run.version }; }
export function fleetQueueAssignmentMatches(base: FleetQueueBase, run: Pick<import("@workspace/api-zod").FleetRun, "id" | "companyId" | "driverUserId" | "vehicleAssetId" | "trailerAssetId">) { return base.runId === run.id && base.companyId === run.companyId && base.driverUserId === run.driverUserId && base.vehicleAssetId === run.vehicleAssetId && base.trailerAssetId === run.trailerAssetId; }
export async function replayFleetSequence(actions: FleetQueuedAction[], transport: {
  scope?: FleetOfflineScope;
  readRun(runId: string): Promise<import("@workspace/api-zod").FleetRun>;
  submit(runId: string, input: FleetActionInput): Promise<import("@workspace/api-zod").FleetRun>;
  resolve(operationId: string, state: "accepted" | "conflict" | "revoked", message?: string): Promise<void>;
}) {
  for (const item of actions) {
    if (item.state !== "unsynced") return;
    try {
      if (transport.scope && (!Number.isInteger(transport.scope.sessionVersion) || item.sessionVersion !== transport.scope.sessionVersion)) { await transport.resolve(item.input.operationId, "revoked", "The verified account session changed. This offline sequence was not submitted."); return; }
      const saved = await transport.readRun(item.runId);
      if (!fleetQueueAssignmentMatches(item.base, saved)) { await transport.resolve(item.input.operationId, "conflict", "Fleet assignment changed. The offline sequence was not rebased."); return; }
      if (saved.events.some(event => event.operationId === item.input.operationId)) { await transport.resolve(item.input.operationId, "accepted"); continue; }
      if (saved.version !== item.input.expectedVersion) { await transport.resolve(item.input.operationId, "conflict", "Fleet run changed. The offline sequence was not rebased."); return; }
      const accepted = await transport.submit(item.runId, item.input);
      if (!accepted.events.some(event => event.operationId === item.input.operationId)) throw new Error("Fleet saved outcome could not be verified.");
      await transport.resolve(item.input.operationId, "accepted");
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 401 || status === 403 || status === 404) await transport.resolve(item.input.operationId, "revoked", "Current account no longer has access to this run.");
      else if (status && status >= 400 && status < 500) await transport.resolve(item.input.operationId, "conflict", error instanceof Error ? error.message : "Fleet refused the offline sequence.");
      throw error;
    }
  }
}
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
      validateBase(scope, action);
      if (!["unsynced", "conflict", "revoked"].includes(action.state)) throw new Error("Fleet queue state is invalid.");
    }
    return value;
  }
  async function write(value: FleetOfflineDocument) { await store.setItem(fleetOfflineKey(value.scope), JSON.stringify(value)); }
  function validateBase(scope: FleetOfflineScope, action: FleetQueuedAction) {
    if (!["acknowledge", "inspect", "start", "pause", "resume", "arrive_stop", "depart_stop", "record_load", "record_delivery", "record_fuel", "record_meter", "submit_closeout"].includes(action.input.action)) throw new Error("Only assigned driver facts can be stored offline.");
    if (action.sessionVersion !== undefined) z.number().int().positive().parse(action.sessionVersion);
    if (action.input.capturedAt && action.input.capturedAt !== action.capturedAt) throw new Error("Fleet original capture time changed.");
    const base = z.object({ runId: z.uuid(), companyId: z.number().int().positive(), driverUserId: z.number().int().positive(), vehicleAssetId: z.uuid(), trailerAssetId: z.uuid().nullable(), version: z.number().int().positive() }).strict().parse(action.base);
    if (base.companyId !== scope.companyId || base.driverUserId !== scope.userId || base.runId !== action.runId) throw new Error("Fleet offline assignment does not match this account.");
  }
  const api = {
    read,
    clear: (scope: FleetOfflineScope) => store.removeItem(fleetOfflineKey(scope)),
    async bindAccount(scope: FleetOfflineScope) {
      if (!Number.isInteger(scope.sessionVersion) || scope.sessionVersion! < 1) throw new Error("Fresh account verification is required before synchronization.");
      const value = await read(scope);
      if (value.scope.sessionVersion !== scope.sessionVersion) {
        value.actions = value.actions.map(action => ({...action,state:"revoked",message:"The verified account session changed. This offline sequence was not submitted."}));
        value.overview = null; value.cachedAt = null;
      }
      value.scope = scope; await write(value);
    },
    async cache(scope: FleetOfflineScope, overview: FleetOverview) {
      if (overview.companyId !== scope.companyId) throw new Error("Fleet company mismatch.");
      const value = await read(scope);
      const ownActions = new Set(["acknowledge", "inspect", "start", "pause", "resume", "arrive_stop", "depart_stop", "record_load", "record_delivery", "record_fuel", "record_meter", "submit_closeout"]);
      value.overview = { ...overview, runs: overview.runs.filter(run => run.driverUserId === scope.userId).map(run => ({ ...run, allowedActions: run.allowedActions.filter(action => ownActions.has(action)) })), observations: [], capabilities: { ...overview.capabilities, canDispatch: false, canManage: false, canSetup: false }, fleets: [], roles: ["driver"] };
      value.cachedAt = new Date().toISOString(); await write(value);
    },
    async enqueue(scope: FleetOfflineScope, action: FleetQueuedAction) {
      z.uuid().parse(action.runId); FleetActionInputSchema.parse(action.input); z.iso.datetime().parse(action.capturedAt);
      validateBase(scope, action);
      action = { ...action, ...(scope.sessionVersion !== undefined ? {sessionVersion:scope.sessionVersion} : {}) };
      const value = await read(scope);
      if (scope.sessionVersion !== undefined && value.scope.sessionVersion !== scope.sessionVersion) throw new Error("Fresh account verification is required before synchronization.");
      const existing = value.actions.find(item => item.input.operationId === action.input.operationId);
      if (existing) { if (existing.sessionVersion !== action.sessionVersion || existing.runId !== action.runId || JSON.stringify(existing.base) !== JSON.stringify(action.base) || existing.capturedAt !== action.capturedAt || JSON.stringify(existing.input) !== JSON.stringify(action.input)) throw new Error("Fleet operation cannot be reused with changed facts."); return existing; }
      const chain = value.actions.filter(item => item.runId === action.runId);
      if (chain.some(item => item.state !== "unsynced")) throw new Error("Resolve the refused Fleet sequence before recording more facts.");
      if (chain.length && JSON.stringify(chain[0].base) !== JSON.stringify(action.base)) throw new Error("Fleet offline assignment changed.");
      const expectedVersion = chain.length ? chain.at(-1)!.input.expectedVersion + 1 : action.base.version;
      if (action.input.expectedVersion !== expectedVersion) throw new Error("Fleet offline sequence revision is not contiguous.");
      if (value.actions.length >= FLEET_OFFLINE_MAX_ACTIONS) throw new Error("Fleet offline queue is full.");
      value.actions.push(action); await write(value); return action;
    },
    async resolve(scope: FleetOfflineScope, operationId: string, outcome: "accepted" | "conflict" | "revoked", message?: string) {
      const value = await read(scope);
      if (outcome === "accepted") value.actions = value.actions.filter(item => item.input.operationId !== operationId);
      else {
        const blocked = value.actions.find(item => item.input.operationId === operationId);
        value.actions = value.actions.map(item => blocked && item.runId === blocked.runId && item.input.expectedVersion >= blocked.input.expectedVersion ? { ...item, state: outcome, message } : item);
      }
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
    bindAccount: (scope: FleetOfflineScope) => serial(() => api.bindAccount(scope)),
    cache: (scope: FleetOfflineScope, overview: FleetOverview) => serial(() => api.cache(scope, overview)),
    enqueue: (scope: FleetOfflineScope, action: FleetQueuedAction) => serial(() => api.enqueue(scope, action)),
    resolve: (scope: FleetOfflineScope, operationId: string, outcome: "accepted" | "conflict" | "revoked", message?: string) => serial(() => api.resolve(scope, operationId, outcome, message)),
    discardRefused: (scope: FleetOfflineScope, operationId: string) => serial(() => api.discardRefused(scope, operationId)),
  };
}
