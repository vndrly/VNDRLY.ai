import { Router, type IRouter } from "express";
import {
  eq,
  and,
  desc,
  isNull,
  sql,
  lt,
  gte,
  isNotNull,
  inArray,
} from "drizzle-orm";
import crypto from "crypto";
import {
  db,
  siteVisitsTable,
  guestSessionsTable,
  siteLocationsTable,
  partnersTable,
  vendorsTable,
  siteWorkAssignmentsTable,
  vendorPeopleTable,
  ticketCheckInsTable,
  ticketsTable,
} from "@workspace/db";
import {
  notifyUsers,
  findPartnerUserIds,
  findVendorUserIds,
  findPartnerVisitNotifierUserIds,
  findVendorVisitNotifierUserIds,
} from "./notifications";
import {
  getCurrentVisitEventSeq,
  publishVisitEvent,
  subscribeVisitEvents,
  type PublishedVisitEvent,
} from "../lib/visit-events";
import { visitEventVisibleToSession } from "../lib/visit-event-visibility";
import {
  assembleAssignedGateSites,
  pickDefaultAssignedSite,
} from "../lib/gate-assigned-sites";
import {
  PlateOcrFailedError,
  PlateOcrUnavailableError,
  readPlateFromImage,
} from "../lib/plate-ocr";
import {
  rankPreferredPlateStates,
  type PlateStateVisitCount,
} from "../lib/plate-state-ranking";
import {
  NATIONAL_PLATE_STATE_FALLBACK,
  normalizePlateState,
  type PlateStateCode,
} from "@workspace/plate-state";

import { SESSION_SECRET } from "../lib/session";
import { enforceVisitsRateLimit } from "../lib/visits-rate-limit";
import { enforcePreferredPlateStatesRateLimit } from "../lib/preferred-plate-states-rate-limit";
import { enforceGateOcrRateLimit } from "../lib/gate-ocr-rate-limit";
import { ObjectStorageService } from "../lib/objectStorage";
import {
  officeMayAccessGateOps,
  sessionHasGateOpsScope,
} from "../lib/gate-ops-access";
import { isGeofenceBypassActive } from "../lib/geo";
import { formatTooFarFromSiteMessage } from "@workspace/map-utils";
import {
  AUTH_GUEST_REQUIRED,
  AUTH_GUEST_EXPIRED,
  AUTH_REQUIRED,
  GUEST_NAME_REQUIRED,
  GUEST_SAFETY_REQUIRED,
  SITE_NOT_FOUND,
  VISIT_INVALID_INPUT,
  VISIT_PARTNER_HOST_MISMATCH,
  VISIT_HOST_VENDOR_REQUIRED,
  VISIT_VENDOR_NOT_ASSIGNED,
  VISIT_LOCATION_REQUIRED,
  VISIT_INVALID_ID,
  VISIT_NOT_FOUND,
  VISIT_NO_ACCESS,
  VISIT_PLATE_OCR_UNAVAILABLE,
  OFF_GEOFENCE,
} from "@workspace/visit-error-codes";
import { trimVisitNotes } from "@workspace/gate-booth";
import { parseVisitEntryCategory } from "../lib/visit-entry-category";

const COOKIE_NAME = "vndrly_session";
const GUEST_COOKIE_NAME = "vndrly_guest";
const GUEST_SESSION_HOURS = 24;
const MAX_GATE_EVIDENCE_BYTES = 8 * 1024 * 1024;
const evidenceStorage = new ObjectStorageService();

type ValidatedPlateInput =
  | { ok: true; vehiclePlate: string | null; plateState: PlateStateCode | null }
  | { ok: false; code: "missing-state" | "invalid-state"; message: string };

function validatePlateInput(
  vehiclePlateInput: unknown,
  plateStateInput: unknown,
): ValidatedPlateInput {
  const vehiclePlate =
    typeof vehiclePlateInput === "string"
      ? vehiclePlateInput.trim() || null
      : null;
  if (!vehiclePlate) return { ok: true, vehiclePlate: null, plateState: null };

  if (
    plateStateInput == null ||
    (typeof plateStateInput === "string" && !plateStateInput.trim())
  ) {
    if (process.env.VNDRLY_REQUIRE_PLATE_STATE !== "1") {
      return { ok: true, vehiclePlate, plateState: null };
    }
    return {
      ok: false,
      code: "missing-state",
      message: "Vehicle state is required when a plate is provided",
    };
  }
  if (typeof plateStateInput !== "string") {
    return {
      ok: false,
      code: "invalid-state",
      message: "Vehicle state must be a valid USPS state code",
    };
  }
  const rawState = plateStateInput.trim();
  const plateState = normalizePlateState(rawState);
  if (!plateState) {
    return {
      ok: false,
      code: "invalid-state",
      message: "Vehicle state must be a valid USPS state code",
    };
  }
  return { ok: true, vehiclePlate, plateState };
}

function admissionStatusOf(value: string | null | undefined): "pending" | "admitted" {
  return value === "pending" ? "pending" : "admitted";
}

async function validateGateEvidencePath(
  raw: unknown,
  userId: number,
): Promise<string | null> {
  if (raw == null || raw === "") return null;
  const path = String(raw).trim();
  if (!/^\/objects\/uploads\/[0-9a-f-]{36}$/i.test(path)) {
    throw new Error("Gate evidence has an invalid storage path.");
  }
  const object = await evidenceStorage.getStoredObject(path);
  const contentType = object.contentType.toLowerCase().split(";")[0].trim();
  const allowedTypes = new Set([
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
  ]);
  if (
    object.acl?.owner !== String(userId) ||
    !allowedTypes.has(contentType) ||
    object.size > MAX_GATE_EVIDENCE_BYTES
  ) {
    throw new Error(
      "Gate evidence is unavailable or is not owned by this session.",
    );
  }
  return path;
}

const COOKIE_OPTIONS_GUEST = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: GUEST_SESSION_HOURS * 60 * 60 * 1000,
};

function signPayload(payload: string): string {
  const sig = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(payload)
    .digest("hex");
  return `${payload}.${sig}`;
}

function verifyPayload(signed: string): string | null {
  const lastDot = signed.lastIndexOf(".");
  if (lastDot === -1) return null;
  const payload = signed.slice(0, lastDot);
  const sig = signed.slice(lastDot + 1);
  const expected = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(payload)
    .digest("hex");
  try {
    if (
      !crypto.timingSafeEqual(
        Buffer.from(sig, "hex"),
        Buffer.from(expected, "hex"),
      )
    )
      return null;
  } catch {
    return null;
  }
  return payload;
}

export type GuestSessionPayload = {
  jti: string;
  guestSessionId: number;
  role: "guest";
  exp: number;
};

function readGuestToken(req: any): string | null {
  // Bearer token first (mobile), then cookie (web).
  const auth = req.headers?.authorization;
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const cookie = req.cookies?.[GUEST_COOKIE_NAME];
  return cookie || null;
}

export function getGuestSessionPayload(req: any): GuestSessionPayload | null {
  const token = readGuestToken(req);
  if (!token) return null;
  const payload = verifyPayload(token);
  if (!payload) return null;
  try {
    const decoded = JSON.parse(
      Buffer.from(payload, "base64").toString("utf-8"),
    ) as GuestSessionPayload;
    if (decoded.role !== "guest") return null;
    if (typeof decoded.exp !== "number" || decoded.exp < Date.now())
      return null;
    return decoded;
  } catch {
    return null;
  }
}

async function requireGuest(req: any, res: any) {
  const payload = getGuestSessionPayload(req);
  if (!payload) {
    res
      .status(401)
      .json({ message: "Guest session required", code: AUTH_GUEST_REQUIRED });
    return null;
  }
  const [g] = await db
    .select()
    .from(guestSessionsTable)
    .where(eq(guestSessionsTable.id, payload.guestSessionId));
  if (!g || g.revokedAt || g.expiresAt.getTime() < Date.now()) {
    res
      .status(401)
      .json({ message: "Guest session expired", code: AUTH_GUEST_EXPIRED });
    return null;
  }
  return { payload, guest: g };
}

// ---------- Standard (non-guest) session helper for /visits listing endpoints
type Session = {
  userId: number;
  role: string;
  vendorId: number | null;
  partnerId: number | null;
  vendorRole?: string | null;
};
function getStaffSession(req: any): Session | null {
  const cookie = req.cookies?.[COOKIE_NAME];
  if (!cookie) return null;
  const payload = verifyPayload(cookie);
  if (!payload) return null;
  try {
    const obj = JSON.parse(Buffer.from(payload, "base64").toString("utf-8"));
    const now = Math.floor(Date.now() / 1000);
    if (!obj || typeof obj.exp !== "number" || obj.exp < now) return null;
    return obj;
  } catch {
    return null;
  }
}

function isGatekeeperSession(session: Session | null): boolean {
  if (!session || session.role !== "vendor" || !session.vendorId) return false;
  return session.vendorRole === "gatekeeper";
}

async function requireGatekeeperSession(
  req: any,
  res: any,
): Promise<Session | null> {
  const session = getStaffSession(req);
  if (!session) {
    res.status(401).json({ message: "Login required", code: AUTH_REQUIRED });
    return null;
  }
  if (!isGatekeeperSession(session)) {
    res
      .status(403)
      .json({ message: "Gatekeeper access required", code: VISIT_NO_ACCESS });
    return null;
  }
  return session;
}

const router: IRouter = Router();

// ---------- POST /api/auth/guest — create a guest session ----------
router.post("/auth/guest", async (req, res): Promise<void> => {
  const b = (req.body ?? {}) as {
    firstName?: string;
    lastName?: string;
    phone?: string;
    email?: string;
    company?: string;
    vehiclePlate?: string;
    plateState?: string;
    purpose?: string;
    safetyAcknowledged?: boolean;
  };
  const firstName = (b.firstName ?? "").trim();
  const lastName = (b.lastName ?? "").trim();
  if (!firstName || !lastName) {
    res
      .status(400)
      .json({
        message: "First name and last name are required",
        code: GUEST_NAME_REQUIRED,
      });
    return;
  }
  if (!b.safetyAcknowledged) {
    res
      .status(400)
      .json({
        message: "Safety acknowledgement is required",
        code: GUEST_SAFETY_REQUIRED,
      });
    return;
  }
  const plate = validatePlateInput(b.vehiclePlate, b.plateState);
  if (!plate.ok) {
    res.status(400).json({ message: plate.message, code: plate.code });
    return;
  }
  const jti = crypto.randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + GUEST_SESSION_HOURS * 60 * 60 * 1000);
  const [row] = await db
    .insert(guestSessionsTable)
    .values({
      tokenJti: jti,
      firstName,
      lastName,
      phone: b.phone?.trim() || null,
      email: b.email?.trim() || null,
      company: b.company?.trim() || null,
      vehiclePlate: plate.vehiclePlate,
      plateState: plate.plateState,
      lastPurpose: b.purpose?.trim() || null,
      expiresAt,
    })
    .returning();

  const payload: GuestSessionPayload = {
    jti,
    guestSessionId: row.id,
    role: "guest",
    exp: expiresAt.getTime(),
  };
  const signed = signPayload(
    Buffer.from(JSON.stringify(payload)).toString("base64"),
  );
  res.cookie(GUEST_COOKIE_NAME, signed, COOKIE_OPTIONS_GUEST);
  res.json({
    token: signed,
    guestSessionId: row.id,
    role: "guest",
    expiresAt: expiresAt.toISOString(),
    profile: {
      firstName: row.firstName,
      lastName: row.lastName,
      phone: row.phone,
      email: row.email,
      company: row.company,
      vehiclePlate: row.vehiclePlate,
      plateState: normalizePlateState(row.plateState),
      lastPurpose: row.lastPurpose,
    },
  });
});

// ---------- GET /api/auth/guest/me ----------
router.get("/auth/guest/me", async (req, res): Promise<void> => {
  const ctx = await requireGuest(req, res);
  if (!ctx) return;
  res.json({
    guestSessionId: ctx.guest.id,
    role: "guest",
    expiresAt: ctx.guest.expiresAt.toISOString(),
    profile: {
      firstName: ctx.guest.firstName,
      lastName: ctx.guest.lastName,
      phone: ctx.guest.phone,
      email: ctx.guest.email,
      company: ctx.guest.company,
      vehiclePlate: ctx.guest.vehiclePlate,
      plateState: normalizePlateState(ctx.guest.plateState),
      lastPurpose: ctx.guest.lastPurpose,
    },
  });
});

// ---------- POST /api/auth/guest/logout ----------
router.post("/auth/guest/logout", async (req, res): Promise<void> => {
  const ctx = await requireGuest(req, res);
  if (ctx) {
    await db
      .update(guestSessionsTable)
      .set({ revokedAt: new Date() })
      .where(eq(guestSessionsTable.id, ctx.guest.id));
  }
  res.clearCookie(GUEST_COOKIE_NAME, { path: "/" });
  res.status(204).send();
});

// ---------- GET /api/visits/site-context/:siteCode (public; no auth required) ----------
router.get(
  "/visits/site-context/:siteCode",
  async (req, res): Promise<void> => {
    const code = req.params.siteCode;
    const [site] = await db
      .select({
        id: siteLocationsTable.id,
        name: siteLocationsTable.name,
        address: siteLocationsTable.address,
        latitude: siteLocationsTable.latitude,
        longitude: siteLocationsTable.longitude,
        siteRadiusMeters: siteLocationsTable.siteRadiusMeters,
        partnerId: siteLocationsTable.partnerId,
        partnerName: partnersTable.name,
        partnerLogoUrl: partnersTable.logoUrl,
        // Surface partner brand colors + square logo so the public visitor
        // page can paint the partner's brand on header accents and primary
        // buttons (Task #158). The visitor route is unauthenticated, so
        // there is no `useBrand` context to lean on — the brand has to come
        // straight from the site row.
        partnerLogoSquareUrl: partnersTable.logoSquareUrl,
        partnerBrandPrimaryColor: partnersTable.brandPrimaryColor,
        partnerBrandAccentColor: partnersTable.brandAccentColor,
      })
      .from(siteLocationsTable)
      .leftJoin(
        partnersTable,
        eq(siteLocationsTable.partnerId, partnersTable.id),
      )
      .where(eq(siteLocationsTable.siteCode, code));
    if (!site) {
      res.status(404).json({ message: "Site not found", code: SITE_NOT_FOUND });
      return;
    }
    const vendors = await db
      .selectDistinct({
        id: vendorsTable.id,
        name: vendorsTable.name,
      })
      .from(siteWorkAssignmentsTable)
      .innerJoin(
        vendorsTable,
        eq(siteWorkAssignmentsTable.vendorId, vendorsTable.id),
      )
      .where(eq(siteWorkAssignmentsTable.siteLocationId, site.id))
      .orderBy(vendorsTable.name);

    res.json({
      site: {
        id: site.id,
        name: site.name,
        address: site.address,
        latitude: site.latitude,
        longitude: site.longitude,
        siteRadiusMeters: site.siteRadiusMeters ?? 805,
        siteCode: code,
      },
      partner: site.partnerId
        ? {
            id: site.partnerId,
            name: site.partnerName,
            logoUrl: site.partnerLogoUrl ?? null,
            logoSquareUrl: site.partnerLogoSquareUrl ?? null,
            brandPrimaryColor: site.partnerBrandPrimaryColor ?? null,
            brandAccentColor: site.partnerBrandAccentColor ?? null,
          }
        : null,
      vendors,
    });
  },
);

function roundPublicCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------- GET /api/visits/public-sites (public; no auth required) ----------
router.get("/visits/public-sites", async (req, res): Promise<void> => {
  const siteCode = typeof req.query.siteCode === "string" ? req.query.siteCode.trim() : "";
  if (!siteCode || siteCode.length > 64) {
    res.json([]);
    return;
  }
  const rows = await db
    .select({
      id: siteLocationsTable.id,
      name: siteLocationsTable.name,
      address: siteLocationsTable.address,
      latitude: siteLocationsTable.latitude,
      longitude: siteLocationsTable.longitude,
      state: siteLocationsTable.state,
      siteCode: siteLocationsTable.siteCode,
      partnerName: partnersTable.name,
    })
    .from(siteLocationsTable)
    .leftJoin(partnersTable, eq(siteLocationsTable.partnerId, partnersTable.id))
    .where(
      and(eq(siteLocationsTable.siteCode, siteCode),
        sql`${siteLocationsTable.isActive} = true AND ${siteLocationsTable.hidden} = false`),
    )
    .orderBy(siteLocationsTable.name)
    .limit(1);
  res.json(
    rows.map((site) => ({
      ...site,
      latitude: roundPublicCoordinate(site.latitude),
      longitude: roundPublicCoordinate(site.longitude),
    })),
  );
});

function distanceMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function requireOfficeGateOpsSession(
  req: any,
  res: any,
): Promise<Session | null> {
  const session = getStaffSession(req);
  if (!session) {
    res.status(401).json({ message: "Login required", code: AUTH_REQUIRED });
    return null;
  }
  if (!officeMayAccessGateOps(session) || !sessionHasGateOpsScope(session)) {
    res
      .status(403)
      .json({
        message: "Office gate log access required",
        code: VISIT_NO_ACCESS,
      });
    return null;
  }
  return session;
}

const GATE_OPS_DAYS = 30;

async function loadAssignedSiteIds(vendorId: number): Promise<number[]> {
  const assignments = await db
    .select({ siteLocationId: siteWorkAssignmentsTable.siteLocationId })
    .from(siteWorkAssignmentsTable)
    .where(eq(siteWorkAssignmentsTable.vendorId, vendorId));
  return [...new Set(assignments.map((row) => row.siteLocationId))];
}

async function loadPartnerSiteIds(partnerId: number): Promise<number[]> {
  const sites = await db
    .select({ id: siteLocationsTable.id })
    .from(siteLocationsTable)
    .where(eq(siteLocationsTable.partnerId, partnerId));
  return sites.map((row) => row.id);
}

const visitListProjection = {
  id: siteVisitsTable.id,
  firstName: siteVisitsTable.firstName,
  lastName: siteVisitsTable.lastName,
  company: siteVisitsTable.company,
  phone: siteVisitsTable.phone,
  email: siteVisitsTable.email,
  vehiclePlate: siteVisitsTable.vehiclePlate,
  plateState: siteVisitsTable.plateState,
  platePhotoUrl: siteVisitsTable.platePhotoUrl,
  vehiclePhotoUrl: siteVisitsTable.vehiclePhotoUrl,
  purpose: siteVisitsTable.purpose,
  entryCategory: siteVisitsTable.entryCategory,
  notes: siteVisitsTable.notes,
  checkOutNotes: siteVisitsTable.checkOutNotes,
  admissionStatus: siteVisitsTable.admissionStatus,
  expectedDurationMinutes: siteVisitsTable.expectedDurationMinutes,
  hostType: siteVisitsTable.hostType,
  hostPartnerId: siteVisitsTable.hostPartnerId,
  hostVendorId: siteVisitsTable.hostVendorId,
  hostPartnerName: partnersTable.name,
  hostVendorName: vendorsTable.name,
  siteLocationId: siteVisitsTable.siteLocationId,
  siteName: siteLocationsTable.name,
  siteCode: siteLocationsTable.siteCode,
  checkInTime: siteVisitsTable.checkInTime,
  checkOutTime: siteVisitsTable.checkOutTime,
  autoCheckedOut: siteVisitsTable.autoCheckedOut,
  checkInLatitude: siteVisitsTable.checkInLatitude,
  checkInLongitude: siteVisitsTable.checkInLongitude,
  recordedByUserId: siteVisitsTable.recordedByUserId,
};

async function loadGateOpsBundle(session: Session) {
  const since = new Date(Date.now() - GATE_OPS_DAYS * 24 * 60 * 60 * 1000);
  let siteIds: number[] | null = null;
  const staffConds = [
    eq(vendorPeopleTable.vendorRole, "gatekeeper"),
    isNull(vendorPeopleTable.deletedAt),
  ];
  if (session.role === "vendor" && session.vendorId) {
    siteIds = await loadAssignedSiteIds(session.vendorId);
    staffConds.push(eq(vendorPeopleTable.vendorId, session.vendorId));
  } else if (session.role === "partner" && session.partnerId) {
    siteIds = await loadPartnerSiteIds(session.partnerId);
    const assignedVendorIds = siteIds.length
      ? [
          ...new Set(
            (
              await db
                .select({ vendorId: siteWorkAssignmentsTable.vendorId })
                .from(siteWorkAssignmentsTable)
                .where(
                  inArray(siteWorkAssignmentsTable.siteLocationId, siteIds),
                )
            ).map((row) => row.vendorId),
          ),
        ]
      : [];
    if (assignedVendorIds.length === 0) {
      staffConds.push(sql`false`);
    } else {
      staffConds.push(inArray(vendorPeopleTable.vendorId, assignedVendorIds));
    }
  }

  const staffRows = await db
    .select({
      employeeId: vendorPeopleTable.id,
      userId: vendorPeopleTable.userId,
      firstName: vendorPeopleTable.firstName,
      lastName: vendorPeopleTable.lastName,
      vendorName: vendorsTable.name,
    })
    .from(vendorPeopleTable)
    .innerJoin(vendorsTable, eq(vendorsTable.id, vendorPeopleTable.vendorId))
    .where(and(...staffConds));

  const visitConds = [sql`(${siteVisitsTable.checkInTime} >= ${since} OR ${siteVisitsTable.checkOutTime} IS NULL)`];
  if (session.role === "vendor" && session.vendorId) {
    visitConds.push(eq(siteVisitsTable.hostVendorId, session.vendorId));
  }
  if (siteIds) {
    if (siteIds.length === 0) {
      return {
        enabled: true,
        visits: [],
        staff: staffRows,
        recordedVisits: [],
        checkIns: [],
      };
    }
    visitConds.push(inArray(siteVisitsTable.siteLocationId, siteIds));
  }

  const visits = await db
    .select(visitListProjection)
    .from(siteVisitsTable)
    .leftJoin(
      siteLocationsTable,
      eq(siteLocationsTable.id, siteVisitsTable.siteLocationId),
    )
    .leftJoin(
      partnersTable,
      eq(partnersTable.id, siteVisitsTable.hostPartnerId),
    )
    .leftJoin(vendorsTable, eq(vendorsTable.id, siteVisitsTable.hostVendorId))
    .where(and(...visitConds))
    .orderBy(desc(siteVisitsTable.checkInTime))
    .limit(2000);

  const employeeIds = staffRows.map((row) => row.employeeId);
  const checkIns = employeeIds.length
    ? await db
        .select({
          employeeId: ticketCheckInsTable.employeeId,
          checkInAt: ticketCheckInsTable.checkInAt,
          checkOutAt: ticketCheckInsTable.checkOutAt,
        })
        .from(ticketCheckInsTable)
        .innerJoin(ticketsTable, eq(ticketsTable.id, ticketCheckInsTable.ticketId))
        .where(
          and(
            inArray(ticketCheckInsTable.employeeId, employeeIds),
            sql`${ticketCheckInsTable.checkInAt} >= ${since}`,
            ...(siteIds ? [inArray(ticketsTable.siteLocationId, siteIds)] : []),
          ),
        )
    : [];

  const enabled = true;
  return {
    enabled,
    visits,
    staff: staffRows.filter((person) => session.role !== "partner" ||
      checkIns.some((clock) => clock.employeeId === person.employeeId) ||
      visits.some((visit) => visit.recordedByUserId != null && visit.recordedByUserId === person.userId)),
    recordedVisits: visits.map((visit) => ({
      recordedByUserId: visit.recordedByUserId ?? null,
      checkInTime: visit.checkInTime,
      checkOutTime: visit.checkOutTime,
    })),
    checkIns,
  };
}

// ---------- GET /api/visits/gate/ops (office live log + staff hours) ----------
router.get("/visits/gate/enabled", async (req, res): Promise<void> => {
  const session = await requireOfficeGateOpsSession(req, res);
  if (!session) return;
  const bundle = await loadGateOpsBundle(session);
  res.json({ enabled: bundle.enabled });
});

router.get("/visits/gate/ops", async (req, res): Promise<void> => {
  const session = await requireOfficeGateOpsSession(req, res);
  if (!session) return;
  const bundle = await loadGateOpsBundle(session);
  res.json({
    enabled: bundle.enabled,
    visits: bundle.visits.map(
      ({ recordedByUserId: _recordedByUserId, ...visit }) => ({
        ...visit,
        plateState: normalizePlateState(visit.plateState),
        checkInTime:
          visit.checkInTime instanceof Date
            ? visit.checkInTime.toISOString()
            : visit.checkInTime,
        checkOutTime:
          visit.checkOutTime instanceof Date
            ? visit.checkOutTime.toISOString()
            : visit.checkOutTime,
      }),
    ),
    staff: bundle.staff,
    recordedVisits: bundle.recordedVisits.map((row) => ({
      recordedByUserId: row.recordedByUserId,
      checkInTime:
        row.checkInTime instanceof Date
          ? row.checkInTime.toISOString()
          : row.checkInTime,
      checkOutTime:
        row.checkOutTime instanceof Date
          ? row.checkOutTime.toISOString()
          : row.checkOutTime,
    })),
    checkIns: bundle.checkIns.map((row) => ({
      employeeId: row.employeeId,
      checkInAt:
        row.checkInAt instanceof Date
          ? row.checkInAt.toISOString()
          : row.checkInAt,
      checkOutAt:
        row.checkOutAt instanceof Date
          ? row.checkOutAt.toISOString()
          : row.checkOutAt,
    })),
  });
});

// ---------- GET /api/visits/gate/assigned-sites (gatekeeper current location) ----------
router.get("/visits/gate/assigned-sites", async (req, res): Promise<void> => {
  const session = await requireGatekeeperSession(req, res);
  if (!session) return;
  const assignments = await db
    .select({
      id: siteWorkAssignmentsTable.id,
      siteLocationId: siteWorkAssignmentsTable.siteLocationId,
    })
    .from(siteWorkAssignmentsTable)
    .where(eq(siteWorkAssignmentsTable.vendorId, session.vendorId!));
  const siteIds = [...new Set(assignments.map((row) => row.siteLocationId))];
  if (siteIds.length === 0) {
    res.json({ sites: [], defaultSite: null });
    return;
  }
  const sites = await db
    .select({
      id: siteLocationsTable.id,
      name: siteLocationsTable.name,
      address: siteLocationsTable.address,
      siteCode: siteLocationsTable.siteCode,
      latitude: siteLocationsTable.latitude,
      longitude: siteLocationsTable.longitude,
      partnerId: siteLocationsTable.partnerId,
      partnerName: partnersTable.name,
      hidden: siteLocationsTable.hidden,
      isActive: siteLocationsTable.isActive,
    })
    .from(siteLocationsTable)
    .innerJoin(partnersTable, eq(partnersTable.id, siteLocationsTable.partnerId))
    .where(inArray(siteLocationsTable.id, siteIds));
  const assembled = assembleAssignedGateSites(assignments, sites);
  res.json({
    sites: assembled,
    defaultSite: pickDefaultAssignedSite(assembled),
  });
});

// ---------- POST /api/visits/gate/read-plate (gatekeeper plate OCR) ----------
router.post("/visits/gate/read-plate", async (req, res): Promise<void> => {
  const session = await requireGatekeeperSession(req, res);
  if (!session) return;
  if (!(await enforceGateOcrRateLimit(req, res, session))) return;
  const b = (req.body ?? {}) as { objectPath?: string };
  if (!b.objectPath) {
    res
      .status(400)
      .json({ message: "Plate photo is required", code: VISIT_INVALID_INPUT });
    return;
  }
  let imageBase64: string;
  let mimeType: string;
  try {
    const path = await validateGateEvidencePath(b.objectPath, session.userId!);
    const object = await evidenceStorage.getStoredObject(path!);
    imageBase64 = object.body.toString("base64");
    mimeType = object.contentType;
  } catch (reason) {
    res
      .status(400)
      .json({
        message:
          reason instanceof Error
            ? reason.message
            : "Plate photo could not be read",
        code: VISIT_INVALID_INPUT,
      });
    return;
  }
  try {
    const candidate = await readPlateFromImage({ imageBase64, mimeType });
    res.json(candidate);
  } catch (reason) {
    if (reason instanceof PlateOcrUnavailableError) {
      res
        .status(503)
        .json({ message: reason.message, code: VISIT_PLATE_OCR_UNAVAILABLE });
      return;
    }
    const message =
      reason instanceof PlateOcrFailedError
        ? reason.message
        : "Plate reading failed.";
    res.status(400).json({ message, code: VISIT_INVALID_INPUT });
  }
});

// ---------- POST /api/visits/gate/check-in (authenticated gatekeeper) ----------
router.post("/visits/gate/check-in", async (req, res): Promise<void> => {
  const session = await requireGatekeeperSession(req, res);
  if (!session) return;
  const b = (req.body ?? {}) as {
    firstName?: string;
    lastName?: string;
    company?: string;
    phone?: string;
    email?: string;
    siteLocationId?: number;
    hostType?: "partner" | "vendor";
    hostPartnerId?: number;
    hostVendorId?: number;
    purpose?: string;
    entryCategory?: unknown;
    expectedDurationMinutes?: number;
    vehiclePlate?: string;
    plateState?: string;
    platePhotoUrl?: string;
    vehiclePhotoUrl?: string;
    notes?: string;
    latitude?: number;
    longitude?: number;
  };
  let entryCategory;
  try { entryCategory = parseVisitEntryCategory(b.entryCategory); }
  catch { res.status(400).json({ message: "Invalid entry category", code: VISIT_INVALID_INPUT }); return; }
  const firstName = String(b.firstName ?? "").trim();
  const lastName = String(b.lastName ?? "").trim();
  if (!firstName || !lastName) {
    res
      .status(400)
      .json({
        message: "First name and last name are required",
        code: GUEST_NAME_REQUIRED,
      });
    return;
  }
  if (
    !b.siteLocationId ||
    !b.hostType ||
    !["partner", "vendor"].includes(b.hostType)
  ) {
    res
      .status(400)
      .json({
        message: "siteLocationId and hostType are required",
        code: VISIT_INVALID_INPUT,
      });
    return;
  }
  const plate = validatePlateInput(b.vehiclePlate, b.plateState);
  if (!plate.ok) {
    res.status(400).json({ message: plate.message, code: plate.code });
    return;
  }
  const [site] = await db
    .select()
    .from(siteLocationsTable)
    .where(eq(siteLocationsTable.id, b.siteLocationId));
  if (!site) {
    res.status(404).json({ message: "Site not found", code: SITE_NOT_FOUND });
    return;
  }
  const [gateAssignment] = await db
    .select({ id: siteWorkAssignmentsTable.id })
    .from(siteWorkAssignmentsTable)
    .where(
      and(
        eq(siteWorkAssignmentsTable.siteLocationId, site.id),
        eq(siteWorkAssignmentsTable.vendorId, session.vendorId!),
      ),
    )
    .limit(1);
  if (!gateAssignment) {
    res
      .status(403)
      .json({
        message: "Gatekeeper vendor is not assigned to this site",
        code: VISIT_NO_ACCESS,
      });
    return;
  }

  let hostName = "";
  if (b.hostType === "partner") {
    if (!b.hostPartnerId || b.hostPartnerId !== site.partnerId) {
      res
        .status(400)
        .json({
          message: "Partner host does not match this site",
          code: VISIT_PARTNER_HOST_MISMATCH,
        });
      return;
    }
    const [p] = await db
      .select({ name: partnersTable.name })
      .from(partnersTable)
      .where(eq(partnersTable.id, b.hostPartnerId));
    hostName = p?.name || "the partner";
  } else {
    if (!b.hostVendorId) {
      res
        .status(400)
        .json({
          message: "hostVendorId is required",
          code: VISIT_HOST_VENDOR_REQUIRED,
        });
      return;
    }
    const [assign] = await db
      .select({ id: siteWorkAssignmentsTable.id })
      .from(siteWorkAssignmentsTable)
      .where(
        and(
          eq(siteWorkAssignmentsTable.siteLocationId, site.id),
          eq(siteWorkAssignmentsTable.vendorId, b.hostVendorId),
        ),
      )
      .limit(1);
    if (!assign) {
      res
        .status(400)
        .json({
          message: "Vendor is not assigned to this site",
          code: VISIT_VENDOR_NOT_ASSIGNED,
        });
      return;
    }
    const [v] = await db
      .select({ name: vendorsTable.name })
      .from(vendorsTable)
      .where(eq(vendorsTable.id, b.hostVendorId));
    hostName = v?.name || "the vendor";
  }

  const radius = site.siteRadiusMeters ?? 805;
  if (typeof b.latitude !== "number" || typeof b.longitude !== "number") {
    res
      .status(400)
      .json({
        message: "Location is required to check in",
        code: VISIT_LOCATION_REQUIRED,
      });
    return;
  }
  const meters = distanceMeters(
    b.latitude,
    b.longitude,
    site.latitude,
    site.longitude,
  );
  if (meters > radius && !isGeofenceBypassActive()) {
    res.status(400).json({
      message: formatTooFarFromSiteMessage(meters, radius),
      code: OFF_GEOFENCE,
      distanceMeters: Math.round(meters),
      radiusMeters: radius,
    });
    return;
  }

  const expectedDuration =
    typeof b.expectedDurationMinutes === "number" &&
    b.expectedDurationMinutes > 0
      ? Math.min(b.expectedDurationMinutes, 24 * 60)
      : null;
  const expiresAt = expectedDuration
    ? new Date(Date.now() + expectedDuration * 60 * 1000)
    : null;
  let platePhotoUrl: string | null;
  let vehiclePhotoUrl: string | null;
  try {
    [platePhotoUrl, vehiclePhotoUrl] = await Promise.all([
      validateGateEvidencePath(b.platePhotoUrl, session.userId!),
      validateGateEvidencePath(b.vehiclePhotoUrl, session.userId!),
    ]);
  } catch (reason) {
    res
      .status(400)
      .json({
        message:
          reason instanceof Error ? reason.message : "Gate evidence is invalid",
        code: VISIT_INVALID_INPUT,
      });
    return;
  }

  const [visit] = await db
    .insert(siteVisitsTable)
    .values({
      siteLocationId: site.id,
      guestSessionId: null,
      firstName,
      lastName,
      phone:
        typeof b.phone === "string" && b.phone.trim() ? b.phone.trim() : null,
      email:
        typeof b.email === "string" && b.email.trim() ? b.email.trim() : null,
      company:
        typeof b.company === "string" && b.company.trim()
          ? b.company.trim()
          : null,
      vehiclePlate: plate.vehiclePlate,
      plateState: plate.plateState,
      platePhotoUrl,
      vehiclePhotoUrl,
      purpose:
        typeof b.purpose === "string" && b.purpose.trim()
          ? b.purpose.trim()
          : null,
      notes: trimVisitNotes(b.notes),
      admissionStatus: "admitted",
      entryCategory,
      expectedDurationMinutes: expectedDuration,
      hostType: b.hostType,
      hostPartnerId: b.hostType === "partner" ? b.hostPartnerId! : null,
      hostVendorId: b.hostType === "vendor" ? b.hostVendorId! : null,
      checkInLatitude: b.latitude,
      checkInLongitude: b.longitude,
      safetyAcknowledgedAt: new Date(),
      expiresAt,
      recordedByUserId: session.userId ?? null,
    })
    .returning();

  const recipients =
    b.hostType === "partner"
      ? await findPartnerVisitNotifierUserIds(b.hostPartnerId!)
      : await findVendorVisitNotifierUserIds(b.hostVendorId!);
  const visitorName = `${visit.firstName} ${visit.lastName}`.trim();
  const companyPart = visit.company ? ` from ${visit.company}` : "";
  const purposePart = visit.purpose ? ` for ${visit.purpose}` : "";
  void notifyUsers(recipients, {
    type: "visitor_checked_in",
    category: "visitor",
    title: "Visitor checked in",
    body: `${visitorName}${companyPart} just checked in at ${site.name}${purposePart}.`,
    link: `/visits/${visit.id}`,
    dedupeKey: `visitor_checked_in:${visit.id}`,
  });

  publishVisitEvent({
    type: "visit.checked_in",
    visit: {
      id: visit.id,
      firstName: visit.firstName,
      lastName: visit.lastName,
      company: visit.company,
      vehiclePlate: visit.vehiclePlate,
      plateState: plate.plateState,
      platePhotoUrl: visit.platePhotoUrl,
      vehiclePhotoUrl: visit.vehiclePhotoUrl,
      purpose: visit.purpose,
      hostType: visit.hostType as "partner" | "vendor",
      hostPartnerId: visit.hostPartnerId,
      hostVendorId: visit.hostVendorId,
      hostPartnerName: b.hostType === "partner" ? hostName : null,
      hostVendorName: b.hostType === "vendor" ? hostName : null,
      siteLocationId: site.id,
      sitePartnerId: site.partnerId,
      siteName: site.name,
      checkInTime: visit.checkInTime.toISOString(),
      checkInLatitude: visit.checkInLatitude,
      checkInLongitude: visit.checkInLongitude,
    },
  });

  res
    .status(201)
    .json({
      ...visit,
      plateState: plate.plateState,
      hostName,
      siteName: site.name,
    });
});

// ---------- POST /api/visits/gate/:id/check-out (authenticated gatekeeper) ----------
router.post("/visits/gate/:id/check-out", async (req, res): Promise<void> => {
  const session = await requireGatekeeperSession(req, res);
  if (!session) return;
  const id = parseInt(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ message: "Invalid id", code: VISIT_INVALID_ID });
    return;
  }
  const b = (req.body ?? {}) as { latitude?: number; longitude?: number; notes?: string };
  const [visit] = await db
    .select()
    .from(siteVisitsTable)
    .where(eq(siteVisitsTable.id, id));
  if (!visit) {
    res.status(404).json({ message: "Visit not found", code: VISIT_NOT_FOUND });
    return;
  }
  const [gateAssignment] = await db
    .select({ id: siteWorkAssignmentsTable.id })
    .from(siteWorkAssignmentsTable)
    .where(
      and(
        eq(siteWorkAssignmentsTable.siteLocationId, visit.siteLocationId),
        eq(siteWorkAssignmentsTable.vendorId, session.vendorId!),
      ),
    )
    .limit(1);
  if (!gateAssignment) {
    res.status(404).json({ message: "Visit not found", code: VISIT_NOT_FOUND });
    return;
  }
  if (visit.checkOutTime) {
    res.json({ ...visit, plateState: normalizePlateState(visit.plateState) });
    return;
  }
  const [updated] = await db
    .update(siteVisitsTable)
    .set({
      checkOutTime: new Date(),
      checkOutLatitude: typeof b.latitude === "number" ? b.latitude : null,
      checkOutLongitude: typeof b.longitude === "number" ? b.longitude : null,
      checkOutNotes: trimVisitNotes(b.notes) ?? visit.checkOutNotes,
    })
    .where(eq(siteVisitsTable.id, id))
    .returning();

  const [siteRow] = await db
    .select({
      partnerId: siteLocationsTable.partnerId,
      name: siteLocationsTable.name,
    })
    .from(siteLocationsTable)
    .where(eq(siteLocationsTable.id, updated.siteLocationId));
  publishVisitEvent({
    type: "visit.checked_out",
    visitId: updated.id,
    siteLocationId: updated.siteLocationId,
    sitePartnerId: siteRow?.partnerId ?? null,
    hostVendorId: updated.hostVendorId,
    checkOutTime: (updated.checkOutTime ?? new Date()).toISOString(),
    autoCheckedOut: false,
    firstName: updated.firstName,
    lastName: updated.lastName,
    company: updated.company,
    vehiclePlate: updated.vehiclePlate,
    plateState: normalizePlateState(updated.plateState),
    platePhotoUrl: updated.platePhotoUrl,
    siteName: siteRow?.name ?? null,
  });

  res.json({
    ...updated,
    plateState: normalizePlateState(updated.plateState),
    admissionStatus: admissionStatusOf(updated.admissionStatus),
  });
});

// ---------- POST /api/visits/gate/:id/admit (authenticated gatekeeper) ----------
router.post("/visits/gate/:id/admit", async (req, res): Promise<void> => {
  const session = await requireGatekeeperSession(req, res);
  if (!session) return;
  const id = parseInt(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ message: "Invalid id", code: VISIT_INVALID_ID });
    return;
  }
  const [visit] = await db
    .select()
    .from(siteVisitsTable)
    .where(eq(siteVisitsTable.id, id));
  if (!visit) {
    res.status(404).json({ message: "Visit not found", code: VISIT_NOT_FOUND });
    return;
  }
  const [gateAssignment] = await db
    .select({ id: siteWorkAssignmentsTable.id })
    .from(siteWorkAssignmentsTable)
    .where(
      and(
        eq(siteWorkAssignmentsTable.siteLocationId, visit.siteLocationId),
        eq(siteWorkAssignmentsTable.vendorId, session.vendorId!),
      ),
    )
    .limit(1);
  if (!gateAssignment) {
    res.status(404).json({ message: "Visit not found", code: VISIT_NOT_FOUND });
    return;
  }
  if (visit.checkOutTime) {
    res.json({
      ...visit,
      plateState: normalizePlateState(visit.plateState),
      admissionStatus: admissionStatusOf(visit.admissionStatus),
    });
    return;
  }
  const [updated] = await db
    .update(siteVisitsTable)
    .set({ admissionStatus: "admitted" })
    .where(eq(siteVisitsTable.id, id))
    .returning();
  res.json({
    ...updated,
    plateState: normalizePlateState(updated.plateState),
    admissionStatus: "admitted",
  });
});

// ---------- POST /api/visits/check-in (guest) ----------
router.post("/visits/check-in", async (req, res): Promise<void> => {
  if (req.body?.entryCategory != null) {
    res.status(403).json({ message: "Entry categories can only be recorded by authorized staff", code: VISIT_NO_ACCESS });
    return;
  }
  const ctx = await requireGuest(req, res);
  if (!ctx) return;
  const b = (req.body ?? {}) as {
    siteLocationId?: number;
    hostType?: "partner" | "vendor";
    hostPartnerId?: number;
    hostVendorId?: number;
    purpose?: string;
    expectedDurationMinutes?: number;
    vehiclePlate?: string;
    plateState?: string;
    platePhotoUrl?: string;
    vehiclePhotoUrl?: string;
    notes?: string;
    latitude?: number;
    longitude?: number;
  };
  if (
    !b.siteLocationId ||
    !b.hostType ||
    !["partner", "vendor"].includes(b.hostType)
  ) {
    res
      .status(400)
      .json({
        message: "siteLocationId and hostType are required",
        code: VISIT_INVALID_INPUT,
      });
    return;
  }
  const bodySuppliesPlate = b.vehiclePlate !== undefined;
  const plate = validatePlateInput(
    bodySuppliesPlate ? b.vehiclePlate : ctx.guest.vehiclePlate,
    bodySuppliesPlate ? b.plateState : (b.plateState ?? ctx.guest.plateState),
  );
  if (!plate.ok) {
    res.status(400).json({ message: plate.message, code: plate.code });
    return;
  }
  const [site] = await db
    .select()
    .from(siteLocationsTable)
    .where(eq(siteLocationsTable.id, b.siteLocationId));
  if (!site) {
    res.status(404).json({ message: "Site not found", code: SITE_NOT_FOUND });
    return;
  }

  // Validate host actually belongs to this site.
  let hostName = "";
  if (b.hostType === "partner") {
    if (!b.hostPartnerId || b.hostPartnerId !== site.partnerId) {
      res
        .status(400)
        .json({
          message: "Partner host does not match this site",
          code: VISIT_PARTNER_HOST_MISMATCH,
        });
      return;
    }
    const [p] = await db
      .select({ name: partnersTable.name })
      .from(partnersTable)
      .where(eq(partnersTable.id, b.hostPartnerId));
    hostName = p?.name || "the partner";
  } else {
    if (!b.hostVendorId) {
      res
        .status(400)
        .json({
          message: "hostVendorId is required",
          code: VISIT_HOST_VENDOR_REQUIRED,
        });
      return;
    }
    const [assign] = await db
      .select({ id: siteWorkAssignmentsTable.id })
      .from(siteWorkAssignmentsTable)
      .where(
        and(
          eq(siteWorkAssignmentsTable.siteLocationId, site.id),
          eq(siteWorkAssignmentsTable.vendorId, b.hostVendorId),
        ),
      )
      .limit(1);
    if (!assign) {
      res
        .status(400)
        .json({
          message: "Vendor is not assigned to this site",
          code: VISIT_VENDOR_NOT_ASSIGNED,
        });
      return;
    }
    const [v] = await db
      .select({ name: vendorsTable.name })
      .from(vendorsTable)
      .where(eq(vendorsTable.id, b.hostVendorId));
    hostName = v?.name || "the vendor";
  }

  // Geofence check.
  const radius = site.siteRadiusMeters ?? 805;
  if (typeof b.latitude !== "number" || typeof b.longitude !== "number") {
    res
      .status(400)
      .json({
        message: "Location is required to check in",
        code: VISIT_LOCATION_REQUIRED,
      });
    return;
  }
  const meters = distanceMeters(
    b.latitude,
    b.longitude,
    site.latitude,
    site.longitude,
  );
  // Demo bypass: while the geofence-bypass window is active (see lib/geo.ts)
  // visitor self-check-in is accepted from anywhere so the demo can drive
  // every flow without being physically at a Mach/Exxon site.
  if (meters > radius && !isGeofenceBypassActive()) {
    res.status(400).json({
      message: formatTooFarFromSiteMessage(meters, radius),
      code: OFF_GEOFENCE,
      distanceMeters: Math.round(meters),
      radiusMeters: radius,
    });
    return;
  }

  // Auto-checkout any prior open visit for this guest.
  const autoClosed = await db
    .update(siteVisitsTable)
    .set({ checkOutTime: new Date(), autoCheckedOut: true })
    .where(
      and(
        eq(siteVisitsTable.guestSessionId, ctx.guest.id),
        isNull(siteVisitsTable.checkOutTime),
      ),
    )
    .returning({
      id: siteVisitsTable.id,
      siteLocationId: siteVisitsTable.siteLocationId,
      hostVendorId: siteVisitsTable.hostVendorId,
      checkOutTime: siteVisitsTable.checkOutTime,
    });
  if (autoClosed.length > 0) {
    const sids = Array.from(new Set(autoClosed.map((r) => r.siteLocationId)));
    const partnerRows = await db
      .select({
        id: siteLocationsTable.id,
        partnerId: siteLocationsTable.partnerId,
      })
      .from(siteLocationsTable)
      .where(sql`${siteLocationsTable.id} = ANY(${sids})`);
    const partnerBySite = new Map(partnerRows.map((r) => [r.id, r.partnerId]));
    for (const r of autoClosed) {
      publishVisitEvent({
        type: "visit.checked_out",
        visitId: r.id,
        siteLocationId: r.siteLocationId,
        sitePartnerId: partnerBySite.get(r.siteLocationId) ?? null,
        hostVendorId: r.hostVendorId,
        checkOutTime: (r.checkOutTime ?? new Date()).toISOString(),
        autoCheckedOut: true,
      });
    }
  }

  const expectedDuration =
    typeof b.expectedDurationMinutes === "number" &&
    b.expectedDurationMinutes > 0
      ? Math.min(b.expectedDurationMinutes, 24 * 60)
      : null;
  const expiresAt = expectedDuration
    ? new Date(Date.now() + expectedDuration * 60 * 1000)
    : null;
  const platePhotoUrl =
    typeof b.platePhotoUrl === "string" && b.platePhotoUrl.trim()
      ? b.platePhotoUrl.trim()
      : null;
  const vehiclePhotoUrl =
    typeof b.vehiclePhotoUrl === "string" && b.vehiclePhotoUrl.trim()
      ? b.vehiclePhotoUrl.trim()
      : null;

  // Persist updated profile fields onto guest_session for future re-use.
  if (b.purpose || b.vehiclePlate !== undefined || b.plateState !== undefined) {
    await db
      .update(guestSessionsTable)
      .set({
        lastPurpose: b.purpose ?? ctx.guest.lastPurpose,
        vehiclePlate: plate.vehiclePlate,
        plateState: plate.plateState,
      })
      .where(eq(guestSessionsTable.id, ctx.guest.id));
  }

  const [visit] = await db
    .insert(siteVisitsTable)
    .values({
      siteLocationId: site.id,
      guestSessionId: ctx.guest.id,
      firstName: ctx.guest.firstName,
      lastName: ctx.guest.lastName,
      phone: ctx.guest.phone,
      email: ctx.guest.email,
      company: ctx.guest.company,
      vehiclePlate: plate.vehiclePlate,
      plateState: plate.plateState,
      platePhotoUrl,
      vehiclePhotoUrl,
      purpose: b.purpose ?? ctx.guest.lastPurpose ?? null,
      notes: trimVisitNotes(b.notes),
      admissionStatus: "pending",
      expectedDurationMinutes: expectedDuration,
      hostType: b.hostType,
      hostPartnerId: b.hostType === "partner" ? b.hostPartnerId! : null,
      hostVendorId: b.hostType === "vendor" ? b.hostVendorId! : null,
      checkInLatitude: b.latitude,
      checkInLongitude: b.longitude,
      safetyAcknowledgedAt: new Date(),
      expiresAt,
    })
    .returning();

  // Notify host org users tagged with the "Visitor Notifications" role.
  // Falls back to all org users if no one is tagged.
  const recipients =
    b.hostType === "partner"
      ? await findPartnerVisitNotifierUserIds(b.hostPartnerId!)
      : await findVendorVisitNotifierUserIds(b.hostVendorId!);
  const visitorName = `${ctx.guest.firstName} ${ctx.guest.lastName}`.trim();
  const companyPart = ctx.guest.company ? ` from ${ctx.guest.company}` : "";
  const purposePart = visit.purpose ? ` for ${visit.purpose}` : "";
  void notifyUsers(recipients, {
    type: "visitor_checked_in",
    category: "visitor",
    title: "Visitor checked in",
    body: `${visitorName}${companyPart} just checked in at ${site.name}${purposePart}.`,
    link: `/visits/${visit.id}`,
    dedupeKey: `visitor_checked_in:${visit.id}`,
  });

  publishVisitEvent({
    type: "visit.checked_in",
    visit: {
      id: visit.id,
      firstName: visit.firstName,
      lastName: visit.lastName,
      company: visit.company,
      vehiclePlate: visit.vehiclePlate,
      plateState: plate.plateState,
      platePhotoUrl: visit.platePhotoUrl,
      vehiclePhotoUrl: visit.vehiclePhotoUrl,
      purpose: visit.purpose,
      hostType: visit.hostType as "partner" | "vendor",
      hostPartnerId: visit.hostPartnerId,
      hostVendorId: visit.hostVendorId,
      hostPartnerName: b.hostType === "partner" ? hostName : null,
      hostVendorName: b.hostType === "vendor" ? hostName : null,
      siteLocationId: site.id,
      sitePartnerId: site.partnerId,
      siteName: site.name,
      checkInTime: visit.checkInTime.toISOString(),
      checkInLatitude: visit.checkInLatitude,
      checkInLongitude: visit.checkInLongitude,
    },
  });

  res
    .status(201)
    .json({
      ...visit,
      plateState: plate.plateState,
      hostName,
      siteName: site.name,
    });
});

// ---------- POST /api/visits/:id/check-out (guest) ----------
router.post("/visits/:id/check-out", async (req, res): Promise<void> => {
  const ctx = await requireGuest(req, res);
  if (!ctx) return;
  const id = parseInt(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ message: "Invalid id", code: VISIT_INVALID_ID });
    return;
  }
  const b = (req.body ?? {}) as { latitude?: number; longitude?: number; notes?: string };
  const [visit] = await db
    .select()
    .from(siteVisitsTable)
    .where(eq(siteVisitsTable.id, id));
  if (!visit || visit.guestSessionId !== ctx.guest.id) {
    res.status(404).json({ message: "Visit not found", code: VISIT_NOT_FOUND });
    return;
  }
  if (visit.checkOutTime) {
    res.json({ ...visit, plateState: normalizePlateState(visit.plateState) });
    return;
  }
  const [updated] = await db
    .update(siteVisitsTable)
    .set({
      checkOutTime: new Date(),
      checkOutLatitude: typeof b.latitude === "number" ? b.latitude : null,
      checkOutLongitude: typeof b.longitude === "number" ? b.longitude : null,
      checkOutNotes: trimVisitNotes(b.notes) ?? visit.checkOutNotes,
    })
    .where(eq(siteVisitsTable.id, id))
    .returning();

  const [siteRow] = await db
    .select({ partnerId: siteLocationsTable.partnerId })
    .from(siteLocationsTable)
    .where(eq(siteLocationsTable.id, updated.siteLocationId));
  publishVisitEvent({
    type: "visit.checked_out",
    visitId: updated.id,
    siteLocationId: updated.siteLocationId,
    sitePartnerId: siteRow?.partnerId ?? null,
    hostVendorId: updated.hostVendorId,
    checkOutTime: (updated.checkOutTime ?? new Date()).toISOString(),
    autoCheckedOut: false,
  });

  res.json({ ...updated, plateState: normalizePlateState(updated.plateState) });
});

// ---------- GET /api/visits/events — server-sent events for visit changes ----------
router.get("/visits/events", async (req, res): Promise<void> => {
  const session = getStaffSession(req);
  if (!session || session.role === "guest") {
    res.status(401).json({ message: "Login required", code: AUTH_REQUIRED });
    return;
  }
  // Task #698: per-session, role-aware rate limit on the SSE
  // visit-events stream. Enforced once per (re)connect — long-lived
  // SSE traffic on an open connection isn't counted, but a tight
  // reconnect loop will trip the limiter just like the polling
  // fallback does.
  if (!(await enforceVisitsRateLimit(req, res, session))) return;

  let assignedSiteIds: Set<number> | null = null;
  const refreshAssignedSites = async (): Promise<void> => {
    if (!isGatekeeperSession(session) || !session.vendorId) return;
    const assignments = await db
      .select({ siteLocationId: siteWorkAssignmentsTable.siteLocationId })
      .from(siteWorkAssignmentsTable)
      .where(eq(siteWorkAssignmentsTable.vendorId, session.vendorId));
    assignedSiteIds = new Set(assignments.map((row) => row.siteLocationId));
  };
  if (isGatekeeperSession(session) && session.vendorId) {
    await refreshAssignedSites();
  }

  const visible = (ev: PublishedVisitEvent): boolean =>
    visitEventVisibleToSession(session, ev, assignedSiteIds);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();
  res.write(`: connected\n\n`);

  // EventSource auto-includes Last-Event-ID on reconnect when prior events
  // wrote `id:` lines. Compare the client's last seen seq against the current
  // global seq so we can warn the client they may have missed events while
  // disconnected. (Only set the gap flag when we actually have a prior id —
  // an initial connection with no history isn't a gap.)
  const lastEventIdHeader = req.header("Last-Event-ID");
  const lastSeenSeqRaw =
    lastEventIdHeader != null ? Number(lastEventIdHeader) : NaN;
  const lastSeenSeq = Number.isFinite(lastSeenSeqRaw) ? lastSeenSeqRaw : null;
  void getCurrentVisitEventSeq()
    .then((currentSeq) => {
      const gap = lastSeenSeq != null && currentSeq > lastSeenSeq;
      const hello = {
        type: "visit.hello" as const,
        currentSeq,
        lastSeenSeq,
        gap,
      };
      try {
        res.write(`event: visit.hello\n`);
        res.write(`data: ${JSON.stringify(hello)}\n\n`);
      } catch {
        /* client gone */
      }
    })
    .catch(() => {
      /* swallow — clients still get live events */
    });

  const heartbeat = setInterval(() => {
    void refreshAssignedSites().catch(() => undefined);
    try {
      res.write(`: ping\n\n`);
    } catch {
      /* ignore */
    }
  }, 25000);

  const unsubscribe = subscribeVisitEvents((ev) => {
    if (!visible(ev)) return;
    try {
      // Always advance Last-Event-ID for visible events so reconnect-time
      // gap detection can compare against this client's actual progress.
      if (typeof ev.seq === "number") {
        res.write(`id: ${ev.seq}\n`);
      }
      res.write(`event: ${ev.type}\n`);
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
    } catch {
      /* client gone — cleanup happens on close */
    }
  });

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
    try {
      res.end();
    } catch {
      /* already ended */
    }
  });
});

// ---------- GET /api/visits/me/active (guest) ----------
router.get("/visits/me/active", async (req, res): Promise<void> => {
  const ctx = await requireGuest(req, res);
  if (!ctx) return;
  const [active] = await db
    .select({
      id: siteVisitsTable.id,
      siteLocationId: siteVisitsTable.siteLocationId,
      siteName: siteLocationsTable.name,
      siteCode: siteLocationsTable.siteCode,
      siteAddress: siteLocationsTable.address,
      hostType: siteVisitsTable.hostType,
      hostPartnerId: siteVisitsTable.hostPartnerId,
      hostVendorId: siteVisitsTable.hostVendorId,
      hostPartnerName: partnersTable.name,
      hostVendorName: vendorsTable.name,
      purpose: siteVisitsTable.purpose,
      entryCategory: siteVisitsTable.entryCategory,
      vehiclePlate: siteVisitsTable.vehiclePlate,
      plateState: siteVisitsTable.plateState,
      platePhotoUrl: siteVisitsTable.platePhotoUrl,
      vehiclePhotoUrl: siteVisitsTable.vehiclePhotoUrl,
      expectedDurationMinutes: siteVisitsTable.expectedDurationMinutes,
      checkInTime: siteVisitsTable.checkInTime,
      expiresAt: siteVisitsTable.expiresAt,
    })
    .from(siteVisitsTable)
    .leftJoin(
      siteLocationsTable,
      eq(siteLocationsTable.id, siteVisitsTable.siteLocationId),
    )
    .leftJoin(
      partnersTable,
      eq(partnersTable.id, siteVisitsTable.hostPartnerId),
    )
    .leftJoin(vendorsTable, eq(vendorsTable.id, siteVisitsTable.hostVendorId))
    .where(
      and(
        eq(siteVisitsTable.guestSessionId, ctx.guest.id),
        isNull(siteVisitsTable.checkOutTime),
      ),
    )
    .orderBy(desc(siteVisitsTable.checkInTime))
    .limit(1);
  res.json(
    active
      ? { ...active, plateState: normalizePlateState(active.plateState) }
      : null,
  );
});

// ---------- GET /api/visits — list with role-aware filtering (staff only) ----------
router.get("/visits", async (req, res): Promise<void> => {
  const session = getStaffSession(req);
  if (!session || session.role === "guest") {
    res.status(401).json({ message: "Login required", code: AUTH_REQUIRED });
    return;
  }
  // Task #698: per-session, role-aware rate limit on the polled
  // visitor list. Applied BEFORE building the joined query so an
  // attacker sweeping site/date filters also gets throttled rather
  // than triggering the joined read on every probe.
  if (!(await enforceVisitsRateLimit(req, res, session))) return;
  const siteParam = req.query.siteLocationId
    ? Number(req.query.siteLocationId)
    : null;
  const fromParam =
    typeof req.query.from === "string" ? new Date(req.query.from) : null;
  const toParam =
    typeof req.query.to === "string" ? new Date(req.query.to) : null;
  const activeOnly = req.query.activeOnly === "true";
  const overlap = req.query.overlap === "true";
  if ((fromParam && Number.isNaN(fromParam.getTime())) ||
      (toParam && Number.isNaN(toParam.getTime())) ||
      (fromParam && toParam && fromParam >= toParam) ||
      (req.query.siteLocationId && (!Number.isSafeInteger(siteParam) || Number(siteParam) <= 0))) {
    res.status(400).json({ message: "Invalid report filters", code: VISIT_INVALID_INPUT });
    return;
  }
  const requestedLimit = Number(req.query.limit);
  const requestedOffset = Number(req.query.offset);
  const limit = Number.isSafeInteger(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 1000)
    : 500;
  const offset = Number.isSafeInteger(requestedOffset)
    ? Math.max(requestedOffset, 0)
    : 0;
  const conds: any[] = [];
  if (activeOnly) conds.push(isNull(siteVisitsTable.checkOutTime));
  if (siteParam && Number.isFinite(siteParam)) {
    conds.push(eq(siteVisitsTable.siteLocationId, siteParam));
  }
  if (fromParam && !Number.isNaN(fromParam.getTime())) {
    conds.push(overlap
      ? sql`(${siteVisitsTable.checkOutTime} IS NULL OR ${siteVisitsTable.checkOutTime} > ${fromParam})`
      : sql`${siteVisitsTable.checkInTime} >= ${fromParam}`);
  }
  if (toParam && !Number.isNaN(toParam.getTime())) {
    conds.push(overlap
      ? sql`${siteVisitsTable.checkInTime} < ${toParam}`
      : sql`${siteVisitsTable.checkInTime} <= ${toParam}`);
  }
  if (isGatekeeperSession(session)) {
    const assignments = await db
      .select({ siteLocationId: siteWorkAssignmentsTable.siteLocationId })
      .from(siteWorkAssignmentsTable)
      .where(eq(siteWorkAssignmentsTable.vendorId, session.vendorId!));
    const assignedSiteIds = [
      ...new Set(assignments.map((row) => row.siteLocationId)),
    ];
    if (assignedSiteIds.length === 0) {
      res.json([]);
      return;
    }
    conds.push(inArray(siteVisitsTable.siteLocationId, assignedSiteIds));
  } else if (session.role === "vendor" && session.vendorId) {
    conds.push(eq(siteVisitsTable.hostVendorId, session.vendorId));
  } else if (session.role === "partner" && session.partnerId) {
    // Partners see all visits at their sites.
    conds.push(eq(siteLocationsTable.partnerId, session.partnerId));
  } else if (session.role !== "admin") {
    res.json([]);
    return;
  }

  const rows = await db
    .select({
      id: siteVisitsTable.id,
      firstName: siteVisitsTable.firstName,
      lastName: siteVisitsTable.lastName,
      company: siteVisitsTable.company,
      phone: siteVisitsTable.phone,
      email: siteVisitsTable.email,
      vehiclePlate: siteVisitsTable.vehiclePlate,
      plateState: siteVisitsTable.plateState,
      platePhotoUrl: siteVisitsTable.platePhotoUrl,
      vehiclePhotoUrl: siteVisitsTable.vehiclePhotoUrl,
      purpose: siteVisitsTable.purpose,
      entryCategory: siteVisitsTable.entryCategory,
      admissionStatus: siteVisitsTable.admissionStatus,
      expectedDurationMinutes: siteVisitsTable.expectedDurationMinutes,
      hostType: siteVisitsTable.hostType,
      hostPartnerId: siteVisitsTable.hostPartnerId,
      hostVendorId: siteVisitsTable.hostVendorId,
      hostPartnerName: partnersTable.name,
      hostVendorName: vendorsTable.name,
      siteLocationId: siteVisitsTable.siteLocationId,
      siteName: siteLocationsTable.name,
      siteCode: siteLocationsTable.siteCode,
      checkInTime: siteVisitsTable.checkInTime,
      checkOutTime: siteVisitsTable.checkOutTime,
      autoCheckedOut: siteVisitsTable.autoCheckedOut,
      checkInLatitude: siteVisitsTable.checkInLatitude,
      checkInLongitude: siteVisitsTable.checkInLongitude,
    })
    .from(siteVisitsTable)
    .leftJoin(
      siteLocationsTable,
      eq(siteLocationsTable.id, siteVisitsTable.siteLocationId),
    )
    .leftJoin(
      partnersTable,
      eq(partnersTable.id, siteVisitsTable.hostPartnerId),
    )
    .leftJoin(vendorsTable, eq(vendorsTable.id, siteVisitsTable.hostVendorId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(siteVisitsTable.checkInTime), desc(siteVisitsTable.id))
    .limit(limit)
    .offset(offset);
  res.json(
    rows.map((row) => ({
      ...row,
      plateState: normalizePlateState(row.plateState),
    })),
  );
});

function parsePlateStateCounts(
  rows: readonly { state: string | null; count: string | number }[],
): PlateStateVisitCount[] {
  return rows.flatMap(({ state, count }) => {
    const parsed = Number(count);
    return Number.isSafeInteger(parsed) && parsed > 0
      ? [{ state, count: parsed }]
      : [];
  });
}

const PREFERRED_PLATE_STATES_CACHE_TTL_MS = 30_000;
const PREFERRED_PLATE_STATES_CACHE_MAX_ENTRIES = 256;
const preferredPlateStatesCache = new Map<
  number,
  { expiresAt: number; preferred: PlateStateCode[] }
>();

function readPreferredPlateStatesCache(
  siteId: number,
): PlateStateCode[] | null {
  const cached = preferredPlateStatesCache.get(siteId);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    preferredPlateStatesCache.delete(siteId);
    return null;
  }
  return [...cached.preferred];
}

function writePreferredPlateStatesCache(
  siteId: number,
  preferred: readonly PlateStateCode[],
): void {
  if (
    !preferredPlateStatesCache.has(siteId) &&
    preferredPlateStatesCache.size >= PREFERRED_PLATE_STATES_CACHE_MAX_ENTRIES
  ) {
    const oldestKey = preferredPlateStatesCache.keys().next().value;
    if (typeof oldestKey === "number")
      preferredPlateStatesCache.delete(oldestKey);
  }
  preferredPlateStatesCache.set(siteId, {
    expiresAt: Date.now() + PREFERRED_PLATE_STATES_CACHE_TTL_MS,
    preferred: [...preferred],
  });
}

// ---------- GET /api/visits/sites/:siteId/preferred-plate-states ----------
router.get(
  "/visits/sites/:siteId/preferred-plate-states",
  async (req, res): Promise<void> => {
    const staffSession = getStaffSession(req);
    const session = staffSession?.role === "guest" ? null : staffSession;
    const guestPayload = getGuestSessionPayload(req);
    // This one read is intentionally available to the public QR flow and to
    // authenticated guests. Its response is a fixed-size aggregate of state
    // codes only: no visit counts, identities, timestamps, or visit details.
    const rateLimitSession =
      session ??
      (guestPayload
        ? { userId: -guestPayload.guestSessionId, role: guestPayload.role }
        : null);
    if (
      !(await enforcePreferredPlateStatesRateLimit(req, res, rateLimitSession))
    )
      return;

    const siteId = Number(req.params.siteId);
    if (!Number.isSafeInteger(siteId) || siteId <= 0) {
      res.status(400).json({ message: "Invalid id", code: VISIT_INVALID_ID });
      return;
    }

    const [site] = await db
      .select({
        id: siteLocationsTable.id,
        partnerId: siteLocationsTable.partnerId,
        siteCode: siteLocationsTable.siteCode,
        isActive: siteLocationsTable.isActive,
        status: siteLocationsTable.status,
        hidden: siteLocationsTable.hidden,
      })
      .from(siteLocationsTable)
      .where(eq(siteLocationsTable.id, siteId));
    if (!site) {
      res.status(404).json({ message: "Site not found", code: SITE_NOT_FOUND });
      return;
    }

    if (!session) {
      const siteProof =
        typeof req.query.siteCode === "string" ? req.query.siteCode.trim() : "";
      if (
        !siteProof ||
        siteProof !== site.siteCode ||
        !site.isActive ||
        site.status !== "active" ||
        site.hidden
      ) {
        res
          .status(404)
          .json({ message: "Site not found", code: SITE_NOT_FOUND });
        return;
      }

      if (guestPayload) {
        const guestContext = await requireGuest(req, res);
        if (!guestContext) return;
        const [activeVisit] = await db
          .select({ siteLocationId: siteVisitsTable.siteLocationId })
          .from(siteVisitsTable)
          .where(
            and(
              eq(siteVisitsTable.guestSessionId, guestContext.guest.id),
              isNull(siteVisitsTable.checkOutTime),
            ),
          )
          .orderBy(desc(siteVisitsTable.checkInTime))
          .limit(1);
        if (activeVisit && activeVisit.siteLocationId !== siteId) {
          res.status(403).json({ message: "Forbidden", code: VISIT_NO_ACCESS });
          return;
        }
      }
    }

    if (
      session &&
      (isGatekeeperSession(session) || session.role === "vendor")
    ) {
      if (!session.vendorId) {
        res.status(403).json({ message: "Forbidden", code: VISIT_NO_ACCESS });
        return;
      }
      const [assignment] = await db
        .select({ id: siteWorkAssignmentsTable.id })
        .from(siteWorkAssignmentsTable)
        .where(
          and(
            eq(siteWorkAssignmentsTable.vendorId, session.vendorId),
            eq(siteWorkAssignmentsTable.siteLocationId, siteId),
          ),
        )
        .limit(1);
      if (!assignment) {
        res.status(403).json({ message: "Forbidden", code: VISIT_NO_ACCESS });
        return;
      }
    } else if (session?.role === "partner") {
      if (site.partnerId !== session.partnerId) {
        res.status(403).json({ message: "Forbidden", code: VISIT_NO_ACCESS });
        return;
      }
    } else if (session && session.role !== "admin") {
      res.status(403).json({ message: "Forbidden", code: VISIT_NO_ACCESS });
      return;
    }

    const cached = readPreferredPlateStatesCache(siteId);
    if (cached) {
      res.json({ preferred: cached });
      return;
    }

    const recentCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const [recentRows, historicalRows] = await Promise.all([
      db
        .select({
          state: siteVisitsTable.plateState,
          count: sql<string | number>`count(*)::int`,
        })
        .from(siteVisitsTable)
        .where(
          and(
            eq(siteVisitsTable.siteLocationId, siteId),
            isNotNull(siteVisitsTable.plateState),
            gte(siteVisitsTable.checkInTime, recentCutoff),
          ),
        )
        .groupBy(siteVisitsTable.plateState),
      db
        .select({
          state: siteVisitsTable.plateState,
          count: sql<string | number>`count(*)::int`,
        })
        .from(siteVisitsTable)
        .where(
          and(
            eq(siteVisitsTable.siteLocationId, siteId),
            isNotNull(siteVisitsTable.plateState),
            lt(siteVisitsTable.checkInTime, recentCutoff),
          ),
        )
        .groupBy(siteVisitsTable.plateState),
    ]);

    const preferred = rankPreferredPlateStates(
      parsePlateStateCounts(recentRows),
      parsePlateStateCounts(historicalRows),
      NATIONAL_PLATE_STATE_FALLBACK,
    );
    writePreferredPlateStatesCache(siteId, preferred);
    res.json({ preferred });
  },
);

// ---------- GET /api/visits/:id — staff detail with role-aware access ----------
router.get("/visits/:id", async (req, res): Promise<void> => {
  const session = getStaffSession(req);
  if (!session || session.role === "guest") {
    res.status(401).json({ message: "Login required", code: AUTH_REQUIRED });
    return;
  }
  if (session.role !== "admin" &&
      !(session.role === "partner" && session.partnerId) &&
      !(session.role === "vendor" && session.vendorId)) {
    res.status(403).json({ message: "Forbidden", code: VISIT_NO_ACCESS });
    return;
  }
  // Task #698: per-session, role-aware rate limit on the visit
  // detail endpoint. Shares the visits-resource budget with the
  // list/SSE so an attacker sweeping visit ids burns down the same
  // window as one polling the list.
  if (!(await enforceVisitsRateLimit(req, res, session))) return;
  const id = parseInt(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ message: "Invalid id", code: VISIT_INVALID_ID });
    return;
  }
  const [v] = await db
    .select({
      id: siteVisitsTable.id,
      firstName: siteVisitsTable.firstName,
      lastName: siteVisitsTable.lastName,
      company: siteVisitsTable.company,
      phone: siteVisitsTable.phone,
      email: siteVisitsTable.email,
      vehiclePlate: siteVisitsTable.vehiclePlate,
      plateState: siteVisitsTable.plateState,
      platePhotoUrl: siteVisitsTable.platePhotoUrl,
      vehiclePhotoUrl: siteVisitsTable.vehiclePhotoUrl,
      purpose: siteVisitsTable.purpose,
      entryCategory: siteVisitsTable.entryCategory,
      expectedDurationMinutes: siteVisitsTable.expectedDurationMinutes,
      hostType: siteVisitsTable.hostType,
      hostPartnerId: siteVisitsTable.hostPartnerId,
      hostVendorId: siteVisitsTable.hostVendorId,
      hostPartnerName: partnersTable.name,
      hostVendorName: vendorsTable.name,
      siteLocationId: siteVisitsTable.siteLocationId,
      siteName: siteLocationsTable.name,
      sitePartnerId: siteLocationsTable.partnerId,
      checkInTime: siteVisitsTable.checkInTime,
      checkOutTime: siteVisitsTable.checkOutTime,
      autoCheckedOut: siteVisitsTable.autoCheckedOut,
      checkInLatitude: siteVisitsTable.checkInLatitude,
      checkInLongitude: siteVisitsTable.checkInLongitude,
      checkOutLatitude: siteVisitsTable.checkOutLatitude,
      checkOutLongitude: siteVisitsTable.checkOutLongitude,
    })
    .from(siteVisitsTable)
    .leftJoin(
      siteLocationsTable,
      eq(siteLocationsTable.id, siteVisitsTable.siteLocationId),
    )
    .leftJoin(
      partnersTable,
      eq(partnersTable.id, siteVisitsTable.hostPartnerId),
    )
    .leftJoin(vendorsTable, eq(vendorsTable.id, siteVisitsTable.hostVendorId))
    .where(eq(siteVisitsTable.id, id));
  if (!v) {
    res.status(404).json({ message: "Visit not found", code: VISIT_NOT_FOUND });
    return;
  }
  if (isGatekeeperSession(session)) {
    const [assignment] = await db
      .select({ id: siteWorkAssignmentsTable.id })
      .from(siteWorkAssignmentsTable)
      .where(
        and(
          eq(siteWorkAssignmentsTable.vendorId, session.vendorId!),
          eq(siteWorkAssignmentsTable.siteLocationId, v.siteLocationId),
        ),
      )
      .limit(1);
    if (!assignment) {
      res.status(403).json({ message: "Forbidden", code: VISIT_NO_ACCESS });
      return;
    }
  } else if (session.role === "vendor" && v.hostVendorId !== session.vendorId) {
    res.status(403).json({ message: "Forbidden", code: VISIT_NO_ACCESS });
    return;
  }
  if (session.role === "partner" && v.sitePartnerId !== session.partnerId) {
    res.status(403).json({ message: "Forbidden", code: VISIT_NO_ACCESS });
    return;
  }
  res.json({ ...v, plateState: normalizePlateState(v.plateState) });
});

// ---------- Auto-checkout sweep (called by rules engine) ----------
export async function sweepStaleVisits(): Promise<number> {
  const now = new Date();
  // expires_at + 30min < now and still open.
  const cutoffSql = sql`${siteVisitsTable.expiresAt} + interval '30 minutes' < now()`;
  const result = await db
    .update(siteVisitsTable)
    .set({ checkOutTime: now, autoCheckedOut: true })
    .where(
      and(
        isNull(siteVisitsTable.checkOutTime),
        isNotNull(siteVisitsTable.expiresAt),
        cutoffSql,
      ),
    )
    .returning({
      id: siteVisitsTable.id,
      siteLocationId: siteVisitsTable.siteLocationId,
      hostVendorId: siteVisitsTable.hostVendorId,
    });

  if (result.length > 0) {
    const siteIds = Array.from(new Set(result.map((r) => r.siteLocationId)));
    const sitePartnerRows = await db
      .select({
        id: siteLocationsTable.id,
        partnerId: siteLocationsTable.partnerId,
      })
      .from(siteLocationsTable)
      .where(sql`${siteLocationsTable.id} = ANY(${siteIds})`);
    const partnerBySite = new Map(
      sitePartnerRows.map((r) => [r.id, r.partnerId]),
    );
    const isoNow = now.toISOString();
    for (const r of result) {
      publishVisitEvent({
        type: "visit.checked_out",
        visitId: r.id,
        siteLocationId: r.siteLocationId,
        sitePartnerId: partnerBySite.get(r.siteLocationId) ?? null,
        hostVendorId: r.hostVendorId,
        checkOutTime: isoNow,
        autoCheckedOut: true,
      });
    }
  }

  return result.length;
}

export default router;
