import { and, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  assetAliasesTable, assetsTable, db, fieldTripCrossingsTable, fieldTripLocationPointsTable, fieldTripsTable, gateStationsTable,
  partnersTable, pool, siteLocationsTable, siteVisitsTable, usersTable, vendorsTable,
} from "@workspace/db";
import type { FastPassTripInput, FastPassTripState } from "@workspace/api-zod";
import { normalizePlateNumber, normalizePlateState } from "@workspace/plate-state";
import { approvedPartnersForVendor } from "../lib/approved-partner-sites";
import { estimateMapboxDrivingRoute } from "../lib/mapbox-routing";
import type { SessionPayload } from "../lib/session";
import { requireChangeOverAccess, requireGateOperatingContext } from "./gate-change-over";
import { confirmedSecureArea, gateDestinations, operativeGateMovements, type GateMovement, type GateTopology } from "./gate-topology";
import { databaseFieldTripRepository } from "./field-trip-database-repository";
import { FieldTripError, type FieldTripRecord, type TripOwner } from "./field-trips";
import { crossingDeduplicationKey, evaluateDirectionalCrossing, type DirectionalCrossing } from "./geofence-crossings";
import { metersBetween } from "./gate-post-policy";

const ETA_WINDOW_MS = 6 * 60_000;
const COORDINATE_TTL_MS = 90_000;
const siteFields = { id: siteLocationsTable.id, name: siteLocationsTable.name, latitude: siteLocationsTable.latitude, longitude: siteLocationsTable.longitude, siteRadiusMeters: siteLocationsTable.siteRadiusMeters };
type Site = Pick<typeof siteLocationsTable.$inferSelect, keyof typeof siteFields>;
type Gate = typeof gateStationsTable.$inferSelect;
function topology(gate: Gate) { return gate.topology as GateTopology | null; }
function choices(gates: Gate[]) {
  const typed = gates.map(gate => ({ ...gate, topology: topology(gate) }));
  const outer = gates.filter(gate => gate.active && !topology(gate)?.area);
  return [...new Map(outer.flatMap(gate => gateDestinations(typed, gate.id)).map(destination => [destination.id, destination])).values()];
}
export function normalizeFastPassIdentity(identity: FastPassTripInput["identity"]) {
  const plateState = normalizePlateState(identity.plateState), vehiclePlate = normalizePlateNumber(identity.vehiclePlate);
  if (!plateState || !vehiclePlate) throw new FieldTripError("trip.invalid_plate", 400);
  return { ...identity, plateState, vehiclePlate };
}
export async function fastPassOptions(userId: number, owner: TripOwner | null) {
  if (!owner) throw new FieldTripError("trip.owner_forbidden", 403);
  const siteScope = owner.type === "vendor"
    ? inArray(siteLocationsTable.partnerId, approvedPartnersForVendor(owner.id))
    : eq(siteLocationsTable.partnerId, owner.id);
  const orgTable = owner.type === "vendor" ? vendorsTable : partnersTable;
  const [[user], [company], vehicles, sites] = await Promise.all([
    db.select({ name: usersTable.displayName }).from(usersTable).where(eq(usersTable.id,userId)).limit(1),
    db.select({ name: orgTable.name }).from(orgTable).where(eq(orgTable.id, owner.id)).limit(1),
    db.select({ id: assetsTable.id, name: assetsTable.name }).from(assetsTable)
      .where(and(eq(assetsTable.responsibleOrgType, owner.type),eq(assetsTable.responsibleOrgId, owner.id),isNull(assetsTable.retiredAt),sql`lower(${assetsTable.category}) in ('vehicle','truck')`)).orderBy(assetsTable.name),
    db.select(siteFields).from(siteLocationsTable)
      .where(and(siteScope,eq(siteLocationsTable.isActive,true),eq(siteLocationsTable.hidden,false),eq(siteLocationsTable.status,"active"))).orderBy(siteLocationsTable.name),
  ]);
  const gates = sites.length ? await db.select().from(gateStationsTable).where(and(inArray(gateStationsTable.siteId, sites.map(site=>site.id)),eq(gateStationsTable.active,true))) : [];
  const [firstName = "", ...lastName] = user?.name?.trim().split(/\s+/) ?? [];
  const plates = vehicles.length ? await db.select({
    assetId: assetAliasesTable.assetId, plate: assetAliasesTable.displayValue, state: assetAliasesTable.jurisdiction,
  }).from(assetAliasesTable).where(and(inArray(assetAliasesTable.assetId, vehicles.map(vehicle => vehicle.id)),
    eq(assetAliasesTable.active, true), eq(assetAliasesTable.kind, "plate"))).orderBy(desc(assetAliasesTable.createdAt)) : [];
  return { owner, userId, firstName, lastName: lastName.join(" "), company: company?.name ?? "",
    vehicles: vehicles.map(vehicle => {
      const plate = plates.find(alias => alias.assetId === vehicle.id);
      return { ...vehicle, vehiclePlate: plate?.plate ?? "", plateState: normalizePlateState(plate?.state) ?? "" };
    }),
    sites: sites.map(site=>({ ...site, destinations: choices(gates.filter(gate=>gate.siteId===site.id)) })) };
}
export async function makeFastPassTrip(siteId: number, input: FastPassTripInput): Promise<FastPassTripState> {
  const [site] = await db.select(siteFields).from(siteLocationsTable)
    .where(and(eq(siteLocationsTable.id,siteId),eq(siteLocationsTable.isActive,true),eq(siteLocationsTable.hidden,false),eq(siteLocationsTable.status,"active"))).limit(1);
  if (!site) throw new FieldTripError("trip.destination_not_found",404);
  const gates = await db.select().from(gateStationsTable).where(eq(gateStationsTable.siteId,siteId));
  const destination = input.destinationId ? choices(gates).find(location=>location.id===input.destinationId) : null;
  if (input.destinationId && !destination) throw new FieldTripError("trip.destination_not_found",404);
  return { identity: normalizeFastPassIdentity(input.identity), destinationId: input.destinationId,
    destinationName: destination?.name ?? site.name, destinationGateId: destination?.gateId ?? null };
}
export async function fastPassHistory(userId: number, owner: TripOwner | null, before?: Date) {
  if (!owner) throw new FieldTripError("trip.owner_forbidden", 403);
  const rows = await db.select({ id: fieldTripsTable.id, siteId: fieldTripsTable.siteLocationId,
    site: siteLocationsTable.name, vehicle: assetsTable.name, startedAt: fieldTripsTable.startedAt,
    completedAt: fieldTripsTable.completedAt, fastPass: fieldTripsTable.fastPass,
    version: fieldTripsTable.version, presenceState: fieldTripsTable.presenceState,
    trackingState: fieldTripsTable.trackingState, checkInTime: siteVisitsTable.checkInTime,
    checkOutTime: siteVisitsTable.checkOutTime, visitId: siteVisitsTable.id })
    .from(fieldTripsTable).innerJoin(siteLocationsTable, eq(siteLocationsTable.id,fieldTripsTable.siteLocationId))
    .leftJoin(assetsTable,eq(assetsTable.id,fieldTripsTable.vehicleAssetId))
    .leftJoin(siteVisitsTable,eq(siteVisitsTable.id,fieldTripsTable.finalVisitId))
    .where(and(eq(fieldTripsTable.driverUserId,userId),eq(fieldTripsTable.ownerOrgType,owner.type),eq(fieldTripsTable.ownerOrgId,owner.id),
      isNotNull(fieldTripsTable.fastPass),before ? sql`${fieldTripsTable.startedAt} < ${before.toISOString()}::timestamptz` : undefined))
    .orderBy(desc(fieldTripsTable.startedAt),desc(fieldTripsTable.id)).limit(51);
  return { trips: rows.slice(0,50), before: rows.length>50 ? rows[49].startedAt.toISOString() : null };
}
export async function fastPassRoute(trip: FieldTripRecord, includeGeometry = true) {
  if (!trip.fastPass || !trip.lastReliablePoint) return null;
  const [site] = await db.select(siteFields).from(siteLocationsTable).where(eq(siteLocationsTable.id,trip.siteLocationId)).limit(1);
  if (!site) return null;
  const origin = trip.lastReliablePoint;
  const gates = await db.select().from(gateStationsTable)
    .where(and(eq(gateStationsTable.siteId, site.id), eq(gateStationsTable.active, true)));
  const preferredGate = trip.presenceState === "on_site" && !trip.fastPass.checkoutRequestedAt
    ? trip.fastPass.destinationGateId : trip.fastPass.clearance?.gateId;
  const outerGates = gates.filter(gate => !topology(gate)?.area && gate.latitude != null && gate.longitude != null);
  const gate = gates.find(candidate => candidate.id === preferredGate) ??
    outerGates.sort((left, right) => metersBetween(origin, { latitude: left.latitude!, longitude: left.longitude! }) -
      metersBetween(origin, { latitude: right.latitude!, longitude: right.longitude! }))[0];
  const destination = { latitude: gate?.latitude ?? site.latitude, longitude: gate?.longitude ?? site.longitude };
  if (Date.now() - origin.recordedAt.getTime() > ETA_WINDOW_MS) return { origin, destination, estimate: null };
  const result = await estimateMapboxDrivingRoute({origin,destination}, { includeGeometry, cacheTtlMs: COORDINATE_TTL_MS });
  return { origin, destination, estimate: result.ok ? result : null };
}
export async function updateFastPassEta(trip: FieldTripRecord) {
  const pass = trip.fastPass;
  if (!pass || trip.presenceState !== "en_route" || (pass.etaAt && Date.now() - Date.parse(pass.etaAt) < COORDINATE_TTL_MS)) return trip;
  const route = await fastPassRoute(trip,false);
  if (!route) return trip;
  const next = { ...pass, arrivalEtaMinutes: route.estimate?.durationMinutes ?? null, etaAt: new Date().toISOString() };
  const [saved] = await db.update(fieldTripsTable).set({ fastPass: next }).where(and(eq(fieldTripsTable.id,trip.id),eq(fieldTripsTable.version,trip.version))).returning({ id:fieldTripsTable.id });
  return saved ? { ...trip, fastPass: next } : await databaseFieldTripRepository.get(trip.id) ?? trip;
}
export async function listFastPassGateTraffic(session: SessionPayload, siteId: number) {
  await requireChangeOverAccess(pool,session,siteId);
  const rows = await db.select({ id:fieldTripsTable.id, fastPass:fieldTripsTable.fastPass,
    presenceState:fieldTripsTable.presenceState, recordedAt:fieldTripsTable.lastRecordedAt,
    latitude:fieldTripsTable.lastLatitude, longitude:fieldTripsTable.lastLongitude, visitId:fieldTripsTable.finalVisitId })
    .from(fieldTripsTable).where(and(eq(fieldTripsTable.siteLocationId,siteId),eq(fieldTripsTable.trackingState,"active"),
      isNotNull(fieldTripsTable.fastPass))).orderBy(desc(fieldTripsTable.updatedAt)).limit(150);
  return { trips: rows.flatMap(row => {
    const pass = row.fastPass as FastPassTripState;
    const fresh = !!row.recordedAt && Date.now()-row.recordedAt.getTime() <= ETA_WINDOW_MS;
    const etaFresh = !!pass.etaAt && Date.now()-Date.parse(pass.etaAt) <= ETA_WINDOW_MS;
    const pending = fresh && (Boolean(pass.clearance) || etaFresh && pass.arrivalEtaMinutes != null && pass.arrivalEtaMinutes<=10);
    if (row.presenceState === "en_route" && !pending) return [];
    return [{...row, fastPass: pass, latitude:fresh?row.latitude:null, longitude:fresh?row.longitude:null}];
  }) };
}
export async function changeFastPassClearance(session: SessionPayload, input: { tripId:string; siteId:number; gateId:string; identity?: FastPassTripInput["identity"] }) {
  const gate = await requireGateOperatingContext(session,input.siteId,input.gateId);
  const [station] = await db.select().from(gateStationsTable).where(and(eq(gateStationsTable.id,gate.stationId),eq(gateStationsTable.siteId,input.siteId),eq(gateStationsTable.active,true))).limit(1);
  if (!station || topology(station)?.area) throw new FieldTripError("trip.outer_gate_required",403);
  return db.transaction(async tx=>{
    const [trip] = await tx.select().from(fieldTripsTable).where(and(eq(fieldTripsTable.id,input.tripId),eq(fieldTripsTable.siteLocationId,input.siteId))).for("update").limit(1);
    if (!trip?.fastPass || trip.trackingState!=="active" || trip.presenceState!=="en_route") throw new FieldTripError("trip.arrival_no_longer_pending",409);
    const pass = trip.fastPass as FastPassTripState;
    if (!trip.lastRecordedAt || Date.now() - +trip.lastRecordedAt > ETA_WINDOW_MS ||
        (!pass.clearance && (!pass.etaAt || Date.now() - Date.parse(pass.etaAt) > ETA_WINDOW_MS ||
          pass.arrivalEtaMinutes == null || pass.arrivalEtaMinutes > 10))) {
      throw new FieldTripError("trip.arrival_no_longer_pending", 409);
    }
    const next = input.identity ? { ...pass, identity:normalizeFastPassIdentity(input.identity) }
      : { ...pass, clearance:{ gateId:gate.stationId,gateName:gate.gateName,approvedAt:new Date().toISOString(),approvedBy:session.userId! } };
    await tx.update(fieldTripsTable).set({fastPass:next,version:trip.version+1,updatedAt:new Date()}).where(eq(fieldTripsTable.id,trip.id));
    return next;
  });
}
/** The staffed gate remains authoritative when the driver needs manual service. */
export async function reconcileFastPassVisit(trip: FieldTripRecord): Promise<FieldTripRecord> {
  const pass = trip.fastPass;
  if (!pass || trip.trackingState !== "active") return trip;
  const [visit] = await db.select({ id: siteVisitsTable.id, checkoutAt: siteVisitsTable.checkOutTime,
    actorId: siteVisitsTable.recordedByUserId })
    .from(siteVisitsTable).where(trip.finalVisitId ? eq(siteVisitsTable.id, trip.finalVisitId) : and(
      eq(siteVisitsTable.siteLocationId, trip.siteLocationId),
      eq(siteVisitsTable.vehiclePlate, pass.identity.vehiclePlate),
      eq(siteVisitsTable.plateState, pass.identity.plateState),
      sql`lower(${siteVisitsTable.firstName}) = lower(${pass.identity.firstName})`,
      sql`lower(${siteVisitsTable.lastName}) = lower(${pass.identity.lastName})`,
      eq(siteVisitsTable.admissionStatus, "admitted"),
      isNotNull(siteVisitsTable.recordedByUserId),
      gte(siteVisitsTable.checkInTime, trip.startedAt),
    )).orderBy(desc(siteVisitsTable.checkInTime)).limit(1);
  if (!visit || (trip.finalVisitId && !visit.checkoutAt)) return trip;
  const [updated] = await db.update(fieldTripsTable).set({
    finalVisitId: visit.id, version: trip.version + 1, updatedAt: new Date(),
    presenceState: visit.checkoutAt ? "off_site" : "on_site",
    ...(visit.checkoutAt ? { trackingState: "completed", completedAt: visit.checkoutAt,
      completionReason: "supervisor_confirmed", completedByUserId: visit.actorId } : {}),
  }).where(and(eq(fieldTripsTable.id, trip.id), eq(fieldTripsTable.version, trip.version))).returning({ id: fieldTripsTable.id });
  if (!updated) return trip;
  return await databaseFieldTripRepository.get(trip.id) ?? trip;
}

export async function requestFastPassExit(trip: FieldTripRecord) {
  if (!trip.fastPass || trip.presenceState!=="on_site" || trip.trackingState!=="active") throw new FieldTripError("trip.not_on_site",409);
  if (trip.fastPass.checkoutRequestedAt) return trip;
  const fastPass = {...trip.fastPass,checkoutRequestedAt:new Date().toISOString()};
  const [result] = await db.update(fieldTripsTable).set({fastPass,version:trip.version+1,updatedAt:new Date()})
    .where(and(eq(fieldTripsTable.id,trip.id),eq(fieldTripsTable.version,trip.version))).returning({ version:fieldTripsTable.version });
  if (!result) throw new FieldTripError("trip.version_conflict");
  return {...trip,fastPass,version:result.version};
}
type Point = typeof fieldTripLocationPointsTable.$inferSelect;
export async function finalizeFastPassCrossing(trip: FieldTripRecord, site: Site, points: Point[], crossing: Exclude<DirectionalCrossing,{kind:"none"}>) {
  const pass = trip.fastPass!;
  const entering = crossing.kind==="entry";
  if (entering ? trip.presenceState!=="en_route" || !pass.clearance || Date.parse(pass.clearance.approvedAt) > +crossing.crossedAt
    : trip.presenceState!=="on_site" || !pass.checkoutRequestedAt || Date.parse(pass.checkoutRequestedAt) > +crossing.crossedAt || !trip.finalVisitId) return null;
  const gates = (await db.select().from(gateStationsTable).where(and(eq(gateStationsTable.siteId,site.id),eq(gateStationsTable.active,true)))).filter(gate=>!topology(gate)?.area);
  const candidates = entering ? gates.filter(gate=>gate.id===pass.clearance?.gateId) : gates;
  const gate = candidates.find(gate=>points.some(point=> {
    if (gate.latitude==null || gate.longitude==null || Math.abs(+point.recordedAt-+crossing.crossedAt)>3*60_000) return false;
    return metersBetween(point,{latitude:gate.latitude,longitude:gate.longitude}) + point.accuracyMeters <= (gate.geofenceRadiusM ?? 80);
  }));
  if (!gate) return null;
  const dedupeKey = crossingDeduplicationKey({ ...trip, direction:crossing.kind,crossedAt:crossing.crossedAt });
  return db.transaction(async tx=>{
    const [current] = await tx.select().from(fieldTripsTable).where(eq(fieldTripsTable.id,trip.id)).for("update").limit(1);
    if (!current || current.version!==trip.version || current.presenceState!==trip.presenceState) return null;
    const baseMovement = { operationId:crypto.randomUUID(), gateId:gate.id,gateName:gate.name,area:"",destinationGateId:null,destination:"remain",at:crossing.crossedAt.toISOString(),actorId:entering?pass.clearance!.approvedBy:trip.driverUserId };
    let visitId = trip.finalVisitId;
    if (entering) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'gate:' + site.id + ':' + pass.identity.plateState + ':' + pass.identity.vehiclePlate}))`);
      const [open] = await tx.select({id:siteVisitsTable.id}).from(siteVisitsTable).where(and(eq(siteVisitsTable.siteLocationId,site.id),eq(siteVisitsTable.vehiclePlate,pass.identity.vehiclePlate),eq(siteVisitsTable.plateState,pass.identity.plateState),isNull(siteVisitsTable.checkOutTime),sql`${siteVisitsTable.reconciliationState} IS DISTINCT FROM 'confirmed_off_site'`)).limit(1);
      if (open) return null;
      const movements: GateMovement[] = [{ ...baseMovement,kind:"enter", note:"Fast Pass entry confirmed by GPS" }];
      if (pass.destinationId) movements.push({...baseMovement,operationId:crypto.randomUUID(),kind:"route",destination:pass.destinationName,destinationId:pass.destinationId,destinationGateId:pass.destinationGateId});
      const [visit] = await tx.insert(siteVisitsTable).values({...pass.identity,
        siteLocationId:site.id,gateStationId:gate.id,gateMovements:movements,
        hostType:trip.owner.type,hostVendorId:trip.owner.type==="vendor"?trip.owner.id:null,hostPartnerId:trip.owner.type==="partner"?trip.owner.id:null,
        checkInTime:crossing.crossedAt,observedArrivalAt:crossing.crossedAt,observedDirection:"entry",observationSource:"geofence",
        admissionStatus:"admitted",reconciliationState:"reconciled",recordedByUserId:pass.clearance!.approvedBy,
      }).returning({id:siteVisitsTable.id});
      visitId = visit.id;
    } else {
      const [visit] = await tx.select().from(siteVisitsTable).where(eq(siteVisitsTable.id,visitId!)).for("update").limit(1);
      const history = (visit?.gateMovements ?? []) as GateMovement[];
      if (!visit || visit.checkOutTime || confirmedSecureArea(history)) return null;
      const missed = operativeGateMovements(history).at(-1)?.destinationGateId != null;
      const movement: GateMovement = {...baseMovement,kind:"site_exit",note:missed?"Exited before inner arrival":"Fast Pass exit confirmed by GPS"};
      await tx.update(siteVisitsTable).set({checkOutTime:crossing.crossedAt,observedDepartureAt:crossing.crossedAt,observedDirection:"exit",
        checkOutNotes:missed?"Exited before inner arrival":null,observationSource:"geofence",gateMovements:[...history,movement]}).where(eq(siteVisitsTable.id,visit.id));
    }
    const [saved] = await tx.insert(fieldTripCrossingsTable).values({tripId:trip.id,siteLocationId:site.id,direction:crossing.kind,crossedAt:crossing.crossedAt,confirmedAt:crossing.confirmedAt,dedupeKey,visitId}).returning();
    await tx.update(fieldTripsTable).set({finalVisitId:visitId,presenceState:entering?"on_site":"off_site",trackingState:entering?"active":"completed",
      ...(entering?{}:{completedAt:crossing.crossedAt,completionReason:"end_of_work",completedByUserId:trip.driverUserId}),
      version:current.version+1,updatedAt:new Date()}).where(eq(fieldTripsTable.id,trip.id));
    return saved;
  });
}
