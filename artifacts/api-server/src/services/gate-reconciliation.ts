import type { AssetAlias, AssetOwner, AssetRecord } from "./assets";
import { pool } from "@workspace/db";

export type GateObservationSource = "camera" | "gatekeeper" | "geofence" | "driver";
export type GateDirection = "entry" | "exit";
export type ReconciliationState = "observed" | "reconciled" | "needs_supervisor_review";
export type SourcedFact<T> = { value: T; source: "observed" | "supplied_later" };

export type GateObservation = {
  direction: GateDirection;
  source: GateObservationSource;
  observedAt: Date;
  observedArrivalAt: Date | null;
  observedDepartureAt: Date | null;
  plate?: string;
  plateState?: string;
  state: ReconciliationState;
  facts: Record<string, SourcedFact<string>>;
  conflictReason?: string;
};

export type ReconciledGateObservation = GateObservation & {
  completedAt?: Date;
  completedByGatekeeperUserId?: number;
};

const clean = (value?: string) => value?.trim() || undefined;
const normalizePlate = (value?: string) => clean(value)?.toUpperCase().replace(/[^A-Z0-9]/g, "");
const normalizeState = (value?: string) => clean(value)?.toUpperCase();

export function observeGateCrossing(input: {
  direction: GateDirection;
  at: Date;
  source: GateObservationSource;
  plate?: string;
  plateState?: string;
}): GateObservation {
  const plate = clean(input.plate);
  const plateState = normalizeState(input.plateState);
  return {
    direction: input.direction,
    source: input.source,
    observedAt: input.at,
    observedArrivalAt: input.direction === "entry" ? input.at : null,
    observedDepartureAt: input.direction === "exit" ? input.at : null,
    ...(plate ? { plate } : {}),
    ...(plateState ? { plateState } : {}),
    state: "observed",
    facts: {
      ...(plate ? { plate: { value: plate, source: "observed" as const } } : {}),
      ...(plateState ? { plateState: { value: plateState, source: "observed" as const } } : {}),
    },
  };
}

export function reconcileVisit(
  observation: GateObservation,
  supplied: { plate?: string; plateState?: string; driverName?: string; company?: string },
): ReconciledGateObservation {
  const suppliedPlate = clean(supplied.plate);
  const suppliedState = normalizeState(supplied.plateState);
  if (observation.plate && suppliedPlate && (
    normalizePlate(observation.plate) !== normalizePlate(suppliedPlate) ||
    (observation.plateState && suppliedState && normalizeState(observation.plateState) !== suppliedState)
  )) {
    return { ...observation, state: "needs_supervisor_review", conflictReason: "gate.conflicting_vehicle_identity" };
  }

  const plate = observation.plate ?? suppliedPlate;
  const plateState = observation.plateState ?? suppliedState;
  const facts = { ...observation.facts };
  if (!observation.plate && suppliedPlate) facts.plate = { value: suppliedPlate, source: "supplied_later" };
  if (!observation.plateState && suppliedState) facts.plateState = { value: suppliedState, source: "supplied_later" };
  if (clean(supplied.driverName)) facts.driverName = { value: clean(supplied.driverName)!, source: "supplied_later" };
  if (clean(supplied.company)) facts.company = { value: clean(supplied.company)!, source: "supplied_later" };
  if (!plate || !facts.driverName || !facts.company) {
    return {
      ...observation,
      ...(plate ? { plate } : {}),
      ...(plateState ? { plateState } : {}),
      facts,
      state: "needs_supervisor_review",
      conflictReason: "gate.unresolved_identity",
    };
  }
  return { ...observation, plate, ...(plateState ? { plateState } : {}), facts, state: "reconciled" };
}

export function completeRetrospectiveVisit(
  observation: GateObservation,
  supplied: { plate?: string; plateState?: string; driverName?: string; company?: string },
  completion: { at: Date; gatekeeperUserId: number },
): ReconciledGateObservation {
  const reconciled = reconcileVisit(observation, supplied);
  return reconciled.state === "reconciled"
    ? { ...reconciled, completedAt: completion.at, completedByGatekeeperUserId: completion.gatekeeperUserId }
    : reconciled;
}

type AssetMatcher = {
  findAsset(alias: AssetAlias): Promise<AssetRecord | null>;
  findOrCreateProvisional(input: { identifier: AssetAlias; responsibleOwner: AssetOwner }): Promise<AssetRecord>;
};

export async function matchVehicleByPlate(input: {
  plate: string;
  plateState: string;
  owner: AssetOwner;
  assets: AssetMatcher;
}): Promise<AssetRecord> {
  const identifier: AssetAlias = {
    kind: "plate",
    value: input.plate,
    jurisdiction: input.plateState.toUpperCase(),
  };
  return (await input.assets.findAsset(identifier)) ?? input.assets.findOrCreateProvisional({ identifier, responsibleOwner: input.owner });
}

export type StaleVisitReview = {
  id: number;
  siteId: number;
  checkOutTime: Date | null;
  expiresAt: Date | null;
  reconciliationState: string;
};

export type StaleVisitReconciliation = {
  id: string;
  visitId: number;
  action: "confirmed_off_site" | "reversal";
  reason: string;
  actorUserId: number;
  reversesReconciliationId: string | null;
  idempotencyKey: string;
  createdAt: Date;
};

export class GateVisitReconciliationError extends Error {
  constructor(public code: string, public status: number) {
    super(code);
  }
}

export interface StaleVisitRepository {
  listNeedingReview(siteIds: number[]): Promise<StaleVisitReview[]>;
  resolve(input: {
    visitId: number;
    allowedSiteIds: number[];
    actorUserId: number;
    reason: string;
    idempotencyKey: string;
  }): Promise<StaleVisitReconciliation>;
  reverse(input: {
    visitId: number;
    reconciliationId: string;
    allowedSiteIds: number[];
    actorUserId: number;
    reason: string;
    idempotencyKey: string;
  }): Promise<StaleVisitReconciliation>;
}

const reconciliationFail = (code: string, status: number): never => {
  throw new GateVisitReconciliationError(code, status);
};

export async function listVisitsNeedingReview(
  input: { siteIds: number[] },
  repository: StaleVisitRepository = databaseStaleVisitRepository,
) {
  return input.siteIds.length ? repository.listNeedingReview(input.siteIds) : [];
}

export async function reconcileStaleVisit(
  input: {
    visitId: number;
    actorUserId: number;
    allowedSiteIds: number[];
    reason: string;
    idempotencyKey: string;
  },
  repository: StaleVisitRepository = databaseStaleVisitRepository,
) {
  const reason = input.reason.trim();
  if (!reason) reconciliationFail("gate.reason_required", 400);
  if (!input.idempotencyKey.trim()) reconciliationFail("gate.idempotency_key_required", 400);
  return repository.resolve({ ...input, reason, idempotencyKey: input.idempotencyKey.trim() });
}

export async function reverseVisitReconciliation(
  input: {
    visitId: number;
    reconciliationId: string;
    actorUserId: number;
    allowedSiteIds: number[];
    supervisor: boolean;
    reason: string;
    idempotencyKey: string;
  },
  repository: StaleVisitRepository = databaseStaleVisitRepository,
) {
  if (!input.supervisor) reconciliationFail("gate.supervisor_required", 403);
  const reason = input.reason.trim();
  if (!reason) reconciliationFail("gate.reason_required", 400);
  if (!input.idempotencyKey.trim()) reconciliationFail("gate.idempotency_key_required", 400);
  return repository.reverse({ ...input, reason, idempotencyKey: input.idempotencyKey.trim() });
}

export const databaseStaleVisitRepository: StaleVisitRepository = {
  async listNeedingReview(siteIds) {
    const result = await pool.query(
      `SELECT id,site_location_id,check_out_time,expires_at,reconciliation_state
       FROM site_visits
       WHERE site_location_id=ANY($1::int[]) AND check_out_time IS NULL
         AND reconciliation_state='needs_review'
       ORDER BY expires_at NULLS LAST, id`,
      [siteIds],
    );
    return result.rows.map((row) => ({
      id: Number(row.id),
      siteId: Number(row.site_location_id),
      checkOutTime: row.check_out_time ? new Date(row.check_out_time) : null,
      expiresAt: row.expires_at ? new Date(row.expires_at) : null,
      reconciliationState: row.reconciliation_state,
    }));
  },

  async resolve(input) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existing = (await client.query(
        "SELECT * FROM gate_visit_reconciliations WHERE idempotency_key=$1",
        [input.idempotencyKey],
      )).rows[0];
      if (existing) {
        if (Number(existing.visit_id) !== input.visitId || existing.action !== "confirmed_off_site")
          reconciliationFail("gate.idempotency_conflict", 409);
        await client.query("COMMIT");
        return reconciliationRow(existing);
      }
      const visit = (await client.query(
        "SELECT id,site_location_id,check_out_time FROM site_visits WHERE id=$1 FOR UPDATE",
        [input.visitId],
      )).rows[0];
      if (!visit || !input.allowedSiteIds.includes(Number(visit.site_location_id)))
        reconciliationFail("gate.visit_not_found", 404);
      if (visit.check_out_time) reconciliationFail("gate.visit_already_closed", 409);
      const row = (await client.query(
        `INSERT INTO gate_visit_reconciliations(visit_id,action,reason,actor_user_id,idempotency_key)
         VALUES($1,'confirmed_off_site',$2,$3,$4) RETURNING *`,
        [input.visitId, input.reason, input.actorUserId, input.idempotencyKey],
      )).rows[0];
      await client.query(
        `UPDATE site_visits SET reconciliation_state='confirmed_off_site',
           reconciled_by_user_id=$2,reconciled_at=now() WHERE id=$1`,
        [input.visitId, input.actorUserId],
      );
      await client.query("COMMIT");
      return reconciliationRow(row);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async reverse(input) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existing = (await client.query(
        "SELECT * FROM gate_visit_reconciliations WHERE idempotency_key=$1",
        [input.idempotencyKey],
      )).rows[0];
      if (existing) {
        if (Number(existing.visit_id) !== input.visitId || existing.action !== "reversal")
          reconciliationFail("gate.idempotency_conflict", 409);
        await client.query("COMMIT");
        return reconciliationRow(existing);
      }
      const visit = (await client.query(
        "SELECT id,site_location_id FROM site_visits WHERE id=$1 FOR UPDATE",
        [input.visitId],
      )).rows[0];
      if (!visit || !input.allowedSiteIds.includes(Number(visit.site_location_id)))
        reconciliationFail("gate.visit_not_found", 404);
      const original = (await client.query(
        `SELECT * FROM gate_visit_reconciliations
         WHERE id=$1 AND visit_id=$2 AND action='confirmed_off_site' FOR UPDATE`,
        [input.reconciliationId, input.visitId],
      )).rows[0];
      if (!original) reconciliationFail("gate.reconciliation_not_found", 404);
      const alreadyReversed = (await client.query(
        "SELECT id FROM gate_visit_reconciliations WHERE reverses_reconciliation_id=$1 LIMIT 1",
        [input.reconciliationId],
      )).rows[0];
      if (alreadyReversed) reconciliationFail("gate.reconciliation_already_reversed", 409);
      const row = (await client.query(
        `INSERT INTO gate_visit_reconciliations(
           visit_id,action,reason,actor_user_id,reverses_reconciliation_id,idempotency_key
         ) VALUES($1,'reversal',$2,$3,$4,$5) RETURNING *`,
        [input.visitId, input.reason, input.actorUserId, input.reconciliationId, input.idempotencyKey],
      )).rows[0];
      await client.query(
        `UPDATE site_visits SET reconciliation_state='needs_review',
           reconciled_by_user_id=NULL,reconciled_at=NULL WHERE id=$1`,
        [input.visitId],
      );
      await client.query("COMMIT");
      return reconciliationRow(row);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
};

function reconciliationRow(row: Record<string, unknown>): StaleVisitReconciliation {
  return {
    id: String(row.id),
    visitId: Number(row.visit_id),
    action: row.action as StaleVisitReconciliation["action"],
    reason: String(row.reason),
    actorUserId: Number(row.actor_user_id),
    reversesReconciliationId: row.reverses_reconciliation_id ? String(row.reverses_reconciliation_id) : null,
    idempotencyKey: String(row.idempotency_key),
    createdAt: new Date(row.created_at as Date | string),
  };
}

export function createMemoryStaleVisitRepository(initial: StaleVisitReview[]): StaleVisitRepository & {
  events(): StaleVisitReconciliation[];
} {
  const visits = new Map(initial.map((visit) => [visit.id, { ...visit }]));
  const reconciliations: StaleVisitReconciliation[] = [];
  const byKey = new Map<string, StaleVisitReconciliation>();
  return {
    events: () => [...reconciliations],
    async listNeedingReview(siteIds) {
      return [...visits.values()].filter((visit) =>
        siteIds.includes(visit.siteId) && visit.checkOutTime === null && visit.reconciliationState === "needs_review",
      );
    },
    async resolve(input) {
      const duplicate = byKey.get(input.idempotencyKey);
      if (duplicate) return duplicate;
      const visit = visits.get(input.visitId);
      if (!visit) throw new GateVisitReconciliationError("gate.visit_not_found", 404);
      if (!input.allowedSiteIds.includes(visit.siteId))
        reconciliationFail("gate.visit_not_found", 404);
      const event: StaleVisitReconciliation = {
        id: `reconciliation-${reconciliations.length + 1}`,
        visitId: input.visitId,
        action: "confirmed_off_site",
        reason: input.reason,
        actorUserId: input.actorUserId,
        reversesReconciliationId: null,
        idempotencyKey: input.idempotencyKey,
        createdAt: new Date(),
      };
      visit.reconciliationState = "confirmed_off_site";
      reconciliations.push(event);
      byKey.set(event.idempotencyKey, event);
      return event;
    },
    async reverse(input) {
      const duplicate = byKey.get(input.idempotencyKey);
      if (duplicate) return duplicate;
      const visit = visits.get(input.visitId);
      const original = reconciliations.find((event) => event.id === input.reconciliationId && event.visitId === input.visitId && event.action === "confirmed_off_site");
      if (!visit) throw new GateVisitReconciliationError("gate.visit_not_found", 404);
      if (!input.allowedSiteIds.includes(visit.siteId))
        reconciliationFail("gate.visit_not_found", 404);
      if (!original) throw new GateVisitReconciliationError("gate.reconciliation_not_found", 404);
      const event: StaleVisitReconciliation = {
        id: `reconciliation-${reconciliations.length + 1}`,
        visitId: input.visitId,
        action: "reversal",
        reason: input.reason,
        actorUserId: input.actorUserId,
        reversesReconciliationId: original.id,
        idempotencyKey: input.idempotencyKey,
        createdAt: new Date(),
      };
      visit.reconciliationState = "needs_review";
      reconciliations.push(event);
      byKey.set(event.idempotencyKey, event);
      return event;
    },
  };
}
