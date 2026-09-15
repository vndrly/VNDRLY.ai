import { Router, type Request, type Response } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod/v4";
import { CompleteFieldTripSchema, StartFieldTripSchema, UpdateFieldTripLocationSchema } from "@workspace/api-zod";
import {
  db,
  fieldTripCrossingsTable,
  fieldTripLocationPointsTable,
  fieldTripsTable,
  locationConsentsTable,
  siteLocationsTable,
  siteVisitsTable,
  usersTable,
  vendorPeopleTable,
} from "@workspace/db";
import { getSessionFromRequest } from "../lib/session";
import { createFieldTripService, FieldTripError, type FieldTripRecord, type TripOwner } from "../services/field-trips";
import { assertFieldTripAccess, authorizeFieldTripCompletion } from "../services/field-trip-access";
import { databaseFieldTripRepository, findActiveTripForDriver } from "../services/field-trip-database-repository";
import { crossingDeduplicationKey, evaluateDirectionalCrossing } from "../services/geofence-crossings";

const router = Router();
const service = createFieldTripService(databaseFieldTripRepository);
const IdSchema = z.string().uuid();

function actor(req: Request) {
  const session = getSessionFromRequest(req);
  if (!session?.userId) throw new FieldTripError("trip.unauthenticated", 401);
  const owner: TripOwner | null = session.vendorId
    ? { type: "vendor", id: session.vendorId }
    : session.partnerId
      ? { type: "partner", id: session.partnerId }
      : null;
  const isAdmin = session.role === "admin" || session.membershipRole === "admin";
  return { session, owner, isAdmin };
}

function assertTripAccess(trip: FieldTripRecord, context: ReturnType<typeof actor>) {
  assertFieldTripAccess(trip, {
    userId: context.session.userId!,
    owner: context.owner,
    isAdmin: context.isAdmin,
    vendorRole: context.session.vendorRole ?? null,
  });
}

function sendError(res: Response, error: unknown) {
  if (error instanceof z.ZodError) return res.status(400).json({ code: "trip.invalid_request", details: error.issues });
  if (error instanceof FieldTripError) return res.status(error.status).json({ code: error.code });
  console.error("Field trip request failed", error);
  return res.status(500).json({ code: "trip.internal_error" });
}

async function finalizeCrossing(trip: FieldTripRecord) {
  const [site, points] = await Promise.all([
    db.select().from(siteLocationsTable).where(eq(siteLocationsTable.id, trip.siteLocationId)).limit(1).then((rows) => rows[0]),
    db.select().from(fieldTripLocationPointsTable).where(and(eq(fieldTripLocationPointsTable.tripId, trip.id), eq(fieldTripLocationPointsTable.reliable, true))).orderBy(desc(fieldTripLocationPointsTable.recordedAt)).limit(12),
  ]);
  if (!site) return { trip, crossing: null };
  const crossing = evaluateDirectionalCrossing(points.reverse().filter((point) => point.distanceToSiteMeters != null).map((point) => ({ at: point.recordedAt, distanceMeters: point.distanceToSiteMeters!, accuracyMeters: point.accuracyMeters })), { radiusMeters: site.siteRadiusMeters ?? 805 });
  if (crossing.kind === "none") return { trip, crossing: null };
  const dedupeKey = crossingDeduplicationKey({ driverUserId: trip.driverUserId, vehicleAssetId: trip.vehicleAssetId, siteLocationId: trip.siteLocationId, direction: crossing.kind, crossedAt: crossing.crossedAt });
  const [createdCrossing] = await db.insert(fieldTripCrossingsTable).values({ tripId: trip.id, siteLocationId: trip.siteLocationId, direction: crossing.kind, crossedAt: crossing.crossedAt, confirmedAt: crossing.confirmedAt, dedupeKey }).onConflictDoNothing({ target: fieldTripCrossingsTable.dedupeKey }).returning();
  if (!createdCrossing) return { trip, crossing: null };

  let visitId: number | null = null;
  if (crossing.kind === "entry") {
    const [[user], [person]] = await Promise.all([
      db.select({ displayName: usersTable.displayName }).from(usersTable).where(eq(usersTable.id, trip.driverUserId)).limit(1),
      db.select({ firstName: vendorPeopleTable.firstName, lastName: vendorPeopleTable.lastName }).from(vendorPeopleTable).where(eq(vendorPeopleTable.userId, trip.driverUserId)).limit(1),
    ]);
    const fallback = (user?.displayName ?? "Field Worker").trim().split(/\s+/);
    const [visit] = await db.insert(siteVisitsTable).values({
      siteLocationId: trip.siteLocationId,
      firstName: person?.firstName ?? fallback[0] ?? "Field",
      lastName: person?.lastName ?? (fallback.slice(1).join(" ") || "Worker"),
      hostType: trip.owner.type,
      hostVendorId: trip.owner.type === "vendor" ? trip.owner.id : null,
      hostPartnerId: trip.owner.type === "partner" ? trip.owner.id : null,
      checkInTime: crossing.crossedAt,
      observedArrivalAt: crossing.crossedAt,
      observedDirection: "entry",
      observationSource: "geofence",
      reconciliationState: "reconciled",
      reconciliationFacts: {},
      reconciledByUserId: trip.driverUserId,
      reconciledAt: crossing.confirmedAt,
      admissionStatus: "admitted",
      recordedByUserId: trip.driverUserId,
    }).returning({ id: siteVisitsTable.id });
    visitId = visit.id;
  } else {
    visitId = trip.finalVisitId;
    if (visitId) {
      await db.update(siteVisitsTable).set({ checkOutTime: crossing.crossedAt, observedDepartureAt: crossing.crossedAt, observedDirection: "exit", observationSource: "geofence", autoCheckedOut: true }).where(and(eq(siteVisitsTable.id, visitId), isNull(siteVisitsTable.checkOutTime)));
    }
  }
  if (!visitId) return { trip, crossing: createdCrossing };
  await db.update(fieldTripCrossingsTable).set({ visitId }).where(eq(fieldTripCrossingsTable.id, createdCrossing.id));
  const finalized = await service.finalizeAutomaticPresence({ tripId: trip.id, expectedVersion: trip.version, direction: crossing.kind, visitId, crossedAt: crossing.crossedAt });
  return { trip: finalized, crossing: { ...createdCrossing, visitId } };
}

router.post("/implementation-a/trips", async (req, res) => {
  try {
    const context = actor(req);
    const input = StartFieldTripSchema.parse(req.body);
    if (context.session.role !== "admin") {
      if (!context.owner || input.owner.type !== context.owner.type || input.owner.id !== context.owner.id) throw new FieldTripError("trip.owner_forbidden", 403);
      if (!context.isAdmin && input.driverUserId !== context.session.userId) throw new FieldTripError("trip.driver_required", 403);
    }
    const [consent] = await db.select({ id: locationConsentsTable.id }).from(locationConsentsTable).where(and(eq(locationConsentsTable.userId, input.driverUserId), isNull(locationConsentsTable.revokedAt))).limit(1);
    if (!consent) throw new FieldTripError("trip.location_consent_required", 403);
    return res.status(201).json(await service.startTrip(input));
  } catch (error) { return sendError(res, error); }
});

router.get("/implementation-a/trips/active", async (req, res) => {
  try {
    const context = actor(req);
    const trip = await findActiveTripForDriver(context.session.userId!);
    if (!trip) return res.json(null);
    assertTripAccess(trip, context);
    return res.json(trip);
  } catch (error) { return sendError(res, error); }
});

router.get("/implementation-a/trips/:tripId", async (req, res) => {
  try {
    const context = actor(req);
    const trip = await databaseFieldTripRepository.get(IdSchema.parse(req.params.tripId));
    if (!trip) throw new FieldTripError("trip.not_found", 404);
    assertTripAccess(trip, context);
    const canSeeExact = context.isAdmin || context.session.userId === trip.driverUserId || ["dispatcher", "foreman", "gate_supervisor", "safety_manager"].includes(context.session.vendorRole ?? "");
    return res.json(canSeeExact ? trip : { id: trip.id, driverUserId: trip.driverUserId, siteLocationId: trip.siteLocationId, presenceState: trip.presenceState, trackingState: trip.trackingState, lastLocation: null, route: null });
  } catch (error) { return sendError(res, error); }
});

router.post("/implementation-a/trips/:tripId/location", async (req, res) => {
  try {
    const context = actor(req);
    const tripId = IdSchema.parse(req.params.tripId);
    const trip = await databaseFieldTripRepository.get(tripId);
    if (!trip) throw new FieldTripError("trip.not_found", 404);
    assertTripAccess(trip, context);
    if (context.session.userId !== trip.driverUserId) throw new FieldTripError("trip.driver_required", 403);
    const input = UpdateFieldTripLocationSchema.parse(req.body);
    const updated = await service.updateTripLocation({ tripId, ...input, recordedAt: new Date(input.recordedAt) });
    return res.status(201).json(await finalizeCrossing(updated));
  } catch (error) { return sendError(res, error); }
});

router.get("/implementation-a/trips/:tripId/eta", async (req, res) => {
  try {
    const context = actor(req);
    const tripId = IdSchema.parse(req.params.tripId);
    const trip = await databaseFieldTripRepository.get(tripId);
    if (!trip) throw new FieldTripError("trip.not_found", 404);
    assertTripAccess(trip, context);
    const [site] = await db.select({ latitude: siteLocationsTable.latitude, longitude: siteLocationsTable.longitude }).from(siteLocationsTable).where(eq(siteLocationsTable.id, trip.siteLocationId)).limit(1);
    if (!site) throw new FieldTripError("trip.destination_not_found", 404);
    return res.json(await service.estimateTripEta(trip.id, site));
  } catch (error) { return sendError(res, error); }
});

router.post("/implementation-a/trips/:tripId/pause", async (req, res) => {
  try {
    const context = actor(req);
    const tripId = IdSchema.parse(req.params.tripId);
    const input = z.object({ expectedVersion: z.number().int().positive() }).parse(req.body);
    return res.json(await service.pauseWorkTracking({ tripId, expectedVersion: input.expectedVersion, actorUserId: context.session.userId! }));
  } catch (error) { return sendError(res, error); }
});

router.post("/implementation-a/trips/:tripId/complete", async (req, res) => {
  try {
    const context = actor(req);
    const tripId = IdSchema.parse(req.params.tripId);
    const trip = await databaseFieldTripRepository.get(tripId);
    if (!trip) throw new FieldTripError("trip.not_found", 404);
    const input = CompleteFieldTripSchema.parse(req.body);
    const { actorMayComplete } = authorizeFieldTripCompletion(trip, {
      userId: context.session.userId!,
      owner: context.owner,
      isAdmin: context.isAdmin,
      vendorRole: context.session.vendorRole ?? null,
    });
    return res.json(await service.completeTrip({
      tripId,
      ...input,
      completedAt: new Date(input.completedAt),
      actorUserId: context.session.userId!,
      actorMayComplete,
    }));
  } catch (error) { return sendError(res, error); }
});

export default router;
