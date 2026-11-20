import { z } from "zod";
import { normalizePlateNumber, normalizePlateState } from "@workspace/plate-state";
import type { SessionPayload } from "../lib/session";
import { ChangeOverError, changeOverTransaction, requireChangeOverAccess, requireGateOperatingContext } from "./gate-change-over";
import { linkedGateScope } from "./gate-links";
import { operativeGateMovements, type GateMovement } from "./gate-topology";

const base = { siteId: z.number().int().positive(), gateId: z.string().uuid(), visitId: z.number().int().positive(), operationId: z.string().uuid() };
export const gateVisitCorrectionSchema = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("edit"), details: z.object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    company: z.string().trim().max(200),
    vehiclePlate: z.string().trim().max(32),
    plateState: z.string().trim().max(32),
  }).strict() }).strict(),
  z.object({ ...base, action: z.literal("undo-checkout"), expectedCheckoutAt: z.string().datetime() }).strict(),
]);
const fail = (status: number, message: string): never => { throw new ChangeOverError(status, "gate_visit.correction_rejected", message); };

export function correctGateVisit(session: SessionPayload, input: z.infer<typeof gateVisitCorrectionSchema>) {
  if (session.publicDemo || session.realm === "demo") fail(403, "This session is read only.");
  return changeOverTransaction(async client => {
    await requireChangeOverAccess(client, session, input.siteId, { stationId: input.gateId });
    const gate = await requireGateOperatingContext(session, input.siteId, input.gateId, client);
    const scope = await linkedGateScope(client, session, input.siteId, true);
    const initial = (await client.query("SELECT vehicle_plate,plate_state FROM site_visits WHERE id=$1 AND site_location_id=ANY($2::int[])", [input.visitId, scope.siteIds])).rows[0];
    if (!initial) fail(404, "Visit unavailable at this site.");
    const tag = input.action === "edit" ? normalizePlateNumber(input.details.vehiclePlate) : initial.vehicle_plate;
    const state = input.action === "edit" ? normalizePlateState(input.details.plateState) : initial.plate_state;
    if (input.action === "edit" && input.details.plateState && !state) fail(400, "Choose a valid issuing state.");
    if (tag) await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`gate:${scope.groupId ?? input.siteId}:${state ?? ""}:${tag}`]);
    const visit = (await client.query("SELECT * FROM site_visits WHERE id=$1 AND site_location_id=ANY($2::int[]) FOR UPDATE", [input.visitId, scope.siteIds])).rows[0];
    if (!visit) fail(404, "Visit unavailable at this site.");
    const history: GateMovement[] = visit.gate_movements ?? [];
    const prior = history.find(movement => movement.operationId === input.operationId);
    const event = {
      operationId: input.operationId, gateId: gate.stationId, gateName: gate.gateName,
      area: "", destinationGateId: null, destination: "remain", at: new Date().toISOString(), actorId: session.userId!,
    };
    const kind = input.action === "edit" ? "edit" : "undo_site_exit";
    if (prior) {
      if (prior.actorId !== event.actorId || prior.kind !== kind) fail(409, "That correction has already been used.");
      return { visitId: input.visitId };
    }
    if (input.action === "undo-checkout" && (visit.vehicle_plate !== tag || visit.plate_state !== state)) fail(409, "The visit changed. Review it before undoing checkout.");
    if (tag && (input.action === "undo-checkout" || !visit.check_out_time)) {
      const duplicate = (await client.query(
        `SELECT id FROM site_visits WHERE site_location_id=ANY($1::int[]) AND id<>$2 AND vehicle_plate=$3
         AND plate_state IS NOT DISTINCT FROM $4 AND check_out_time IS NULL AND reconciliation_state IS DISTINCT FROM 'confirmed_off_site' LIMIT 1`,
        [scope.siteIds, input.visitId, tag, state],
      )).rows[0];
      if (duplicate) fail(409, "This tag already has another open visit. Review the On Site list.");
    }
    if (input.action === "edit") {
      const previous = { firstName: visit.first_name, lastName: visit.last_name, company: visit.company, vehiclePlate: visit.vehicle_plate, plateState: visit.plate_state };
      const corrected = { ...input.details, company: input.details.company || null, vehiclePlate: tag, plateState: state };
      const changes = Object.fromEntries(Object.entries(corrected).filter(([key,value]) => previous[key as keyof typeof previous] !== value)
        .map(([key,value]) => [key, { from: previous[key as keyof typeof previous], to: value }]));
      if (!Object.keys(changes).length) return { visitId: input.visitId };
      const movement: GateMovement = { ...event, kind, note: "Visit details corrected", changes };
      await client.query("UPDATE site_visits SET first_name=$2,last_name=$3,company=$4,vehicle_plate=$5,plate_state=$6,gate_movements=gate_movements || $7::jsonb WHERE id=$1",
        [input.visitId, corrected.firstName, corrected.lastName, corrected.company, tag, state, JSON.stringify([movement])]);
    } else {
      const exit = operativeGateMovements(history).at(-1);
      const checkoutAt = visit.check_out_time && new Date(visit.check_out_time).toISOString();
      if (!checkoutAt || checkoutAt !== new Date(input.expectedCheckoutAt).toISOString()) fail(409, "This checkout changed. Review the current departure.");
      if (!exit || exit.kind !== "site_exit") return fail(409, "This departure has no Gate checkout to undo.");
      const movement: GateMovement = {
        ...event, kind, note: "Checkout reversed", reversesOperationId: exit.operationId,
        changes: { checkoutAt, checkOutNotes: visit.check_out_notes, checkOutGpsEvidence: visit.check_out_gps_evidence },
      };
      await client.query(
        `UPDATE site_visits SET check_out_time=NULL,check_out_latitude=NULL,check_out_longitude=NULL,check_out_gps_evidence=NULL,
         check_out_notes=NULL,observed_departure_at=NULL,observed_direction=CASE WHEN observed_arrival_at IS NOT NULL THEN 'entry' ELSE NULL END,
         auto_checked_out=false,gate_movements=gate_movements || $2::jsonb WHERE id=$1`,
        [input.visitId, JSON.stringify([movement])],
      );
    }
    return { visitId: input.visitId };
  });
}
