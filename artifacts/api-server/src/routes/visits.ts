import { Router, type IRouter } from "express";
import { eq, and, desc, isNull, sql, lt, isNotNull } from "drizzle-orm";
import crypto from "crypto";
import {
  db,
  siteVisitsTable,
  guestSessionsTable,
  siteLocationsTable,
  partnersTable,
  vendorsTable,
  siteWorkAssignmentsTable,
  usersTable,
} from "@workspace/db";
import { notifyUsers, findPartnerUserIds, findVendorUserIds, findPartnerVisitNotifierUserIds, findVendorVisitNotifierUserIds } from "./notifications";
import {
  getCurrentVisitEventSeq,
  publishVisitEvent,
  subscribeVisitEvents,
  type PublishedVisitEvent,
} from "../lib/visit-events";

import { SESSION_SECRET } from "../lib/session";
import { enforceVisitsRateLimit } from "../lib/visits-rate-limit";
import { isGeofenceBypassActive } from "../lib/geo";
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
  OFF_GEOFENCE,
} from "@workspace/visit-error-codes";

const COOKIE_NAME = "vndrly_session";
const GUEST_COOKIE_NAME = "vndrly_guest";
const GUEST_SESSION_HOURS = 24;

const COOKIE_OPTIONS_GUEST = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: GUEST_SESSION_HOURS * 60 * 60 * 1000,
};

function signPayload(payload: string): string {
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

function verifyPayload(signed: string): string | null {
  const lastDot = signed.lastIndexOf(".");
  if (lastDot === -1) return null;
  const payload = signed.slice(0, lastDot);
  const sig = signed.slice(lastDot + 1);
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) return null;
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
    const decoded = JSON.parse(Buffer.from(payload, "base64").toString("utf-8")) as GuestSessionPayload;
    if (decoded.role !== "guest") return null;
    if (typeof decoded.exp !== "number" || decoded.exp < Date.now()) return null;
    return decoded;
  } catch {
    return null;
  }
}

async function requireGuest(req: any, res: any) {
  const payload = getGuestSessionPayload(req);
  if (!payload) {
    res.status(401).json({ message: "Guest session required", code: AUTH_GUEST_REQUIRED });
    return null;
  }
  const [g] = await db
    .select()
    .from(guestSessionsTable)
    .where(eq(guestSessionsTable.id, payload.guestSessionId));
  if (!g || g.revokedAt || g.expiresAt.getTime() < Date.now()) {
    res.status(401).json({ message: "Guest session expired", code: AUTH_GUEST_EXPIRED });
    return null;
  }
  return { payload, guest: g };
}

// ---------- Standard (non-guest) session helper for /visits listing endpoints
type Session = { userId: number; role: string; vendorId: number | null; partnerId: number | null };
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
    purpose?: string;
    safetyAcknowledged?: boolean;
  };
  const firstName = (b.firstName ?? "").trim();
  const lastName = (b.lastName ?? "").trim();
  if (!firstName || !lastName) {
    res.status(400).json({ message: "First name and last name are required", code: GUEST_NAME_REQUIRED });
    return;
  }
  if (!b.safetyAcknowledged) {
    res.status(400).json({ message: "Safety acknowledgement is required", code: GUEST_SAFETY_REQUIRED });
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
      vehiclePlate: b.vehiclePlate?.trim() || null,
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
  const signed = signPayload(Buffer.from(JSON.stringify(payload)).toString("base64"));
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
router.get("/visits/site-context/:siteCode", async (req, res): Promise<void> => {
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
    .leftJoin(partnersTable, eq(siteLocationsTable.partnerId, partnersTable.id))
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
    .innerJoin(vendorsTable, eq(siteWorkAssignmentsTable.vendorId, vendorsTable.id))
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
});

// ---------- GET /api/visits/public-sites (public; no auth required) ----------
router.get("/visits/public-sites", async (_req, res): Promise<void> => {
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
    .where(sql`${siteLocationsTable.isActive} = true AND ${siteLocationsTable.hidden} = false`);
  res.json(rows);
});

function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ---------- POST /api/visits/check-in (guest) ----------
router.post("/visits/check-in", async (req, res): Promise<void> => {
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
    latitude?: number;
    longitude?: number;
  };
  if (!b.siteLocationId || !b.hostType || !["partner", "vendor"].includes(b.hostType)) {
    res.status(400).json({ message: "siteLocationId and hostType are required", code: VISIT_INVALID_INPUT });
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
      res.status(400).json({ message: "Partner host does not match this site", code: VISIT_PARTNER_HOST_MISMATCH });
      return;
    }
    const [p] = await db.select({ name: partnersTable.name }).from(partnersTable).where(eq(partnersTable.id, b.hostPartnerId));
    hostName = p?.name || "the partner";
  } else {
    if (!b.hostVendorId) {
      res.status(400).json({ message: "hostVendorId is required", code: VISIT_HOST_VENDOR_REQUIRED });
      return;
    }
    const [assign] = await db
      .select({ id: siteWorkAssignmentsTable.id })
      .from(siteWorkAssignmentsTable)
      .where(and(eq(siteWorkAssignmentsTable.siteLocationId, site.id), eq(siteWorkAssignmentsTable.vendorId, b.hostVendorId)))
      .limit(1);
    if (!assign) {
      res.status(400).json({ message: "Vendor is not assigned to this site", code: VISIT_VENDOR_NOT_ASSIGNED });
      return;
    }
    const [v] = await db.select({ name: vendorsTable.name }).from(vendorsTable).where(eq(vendorsTable.id, b.hostVendorId));
    hostName = v?.name || "the vendor";
  }

  // Geofence check.
  const radius = site.siteRadiusMeters ?? 805;
  if (typeof b.latitude !== "number" || typeof b.longitude !== "number") {
    res.status(400).json({ message: "Location is required to check in", code: VISIT_LOCATION_REQUIRED });
    return;
  }
  const meters = distanceMeters(b.latitude, b.longitude, site.latitude, site.longitude);
  // Demo bypass: while the geofence-bypass window is active (see lib/geo.ts)
  // visitor self-check-in is accepted from anywhere so the demo can drive
  // every flow without being physically at a Mach/Exxon site.
  if (meters > radius && !isGeofenceBypassActive()) {
    res.status(400).json({
      message: `You are too far from the site (${Math.round(meters)}m away, must be within ${radius}m).`,
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
    .where(and(eq(siteVisitsTable.guestSessionId, ctx.guest.id), isNull(siteVisitsTable.checkOutTime)))
    .returning({
      id: siteVisitsTable.id,
      siteLocationId: siteVisitsTable.siteLocationId,
      hostVendorId: siteVisitsTable.hostVendorId,
      checkOutTime: siteVisitsTable.checkOutTime,
    });
  if (autoClosed.length > 0) {
    const sids = Array.from(new Set(autoClosed.map((r) => r.siteLocationId)));
    const partnerRows = await db
      .select({ id: siteLocationsTable.id, partnerId: siteLocationsTable.partnerId })
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

  const expectedDuration = typeof b.expectedDurationMinutes === "number" && b.expectedDurationMinutes > 0
    ? Math.min(b.expectedDurationMinutes, 24 * 60)
    : null;
  const expiresAt = expectedDuration ? new Date(Date.now() + expectedDuration * 60 * 1000) : null;

  // Persist updated profile fields onto guest_session for future re-use.
  if (b.purpose || b.vehiclePlate) {
    await db
      .update(guestSessionsTable)
      .set({
        lastPurpose: b.purpose ?? ctx.guest.lastPurpose,
        vehiclePlate: b.vehiclePlate ?? ctx.guest.vehiclePlate,
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
      vehiclePlate: b.vehiclePlate ?? ctx.guest.vehiclePlate,
      purpose: b.purpose ?? ctx.guest.lastPurpose ?? null,
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

  res.status(201).json({ ...visit, hostName, siteName: site.name });
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
  const b = (req.body ?? {}) as { latitude?: number; longitude?: number };
  const [visit] = await db.select().from(siteVisitsTable).where(eq(siteVisitsTable.id, id));
  if (!visit || visit.guestSessionId !== ctx.guest.id) {
    res.status(404).json({ message: "Visit not found", code: VISIT_NOT_FOUND });
    return;
  }
  if (visit.checkOutTime) {
    res.json(visit);
    return;
  }
  const [updated] = await db
    .update(siteVisitsTable)
    .set({
      checkOutTime: new Date(),
      checkOutLatitude: typeof b.latitude === "number" ? b.latitude : null,
      checkOutLongitude: typeof b.longitude === "number" ? b.longitude : null,
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

  res.json(updated);
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
  if (!await enforceVisitsRateLimit(req, res, session)) return;

  const visible = (ev: PublishedVisitEvent): boolean => {
    if (session.role === "admin") return true;
    if (session.role === "vendor" && session.vendorId) {
      const vid = ev.type === "visit.checked_in" ? ev.visit.hostVendorId : ev.hostVendorId;
      return vid === session.vendorId;
    }
    if (session.role === "partner" && session.partnerId) {
      const pid = ev.type === "visit.checked_in" ? ev.visit.sitePartnerId : ev.sitePartnerId;
      return pid === session.partnerId;
    }
    return false;
  };

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
  const lastSeenSeqRaw = lastEventIdHeader != null ? Number(lastEventIdHeader) : NaN;
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
    try { res.write(`: ping\n\n`); } catch { /* ignore */ }
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
    try { res.end(); } catch { /* already ended */ }
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
      siteAddress: siteLocationsTable.address,
      hostType: siteVisitsTable.hostType,
      hostPartnerId: siteVisitsTable.hostPartnerId,
      hostVendorId: siteVisitsTable.hostVendorId,
      hostPartnerName: partnersTable.name,
      hostVendorName: vendorsTable.name,
      purpose: siteVisitsTable.purpose,
      expectedDurationMinutes: siteVisitsTable.expectedDurationMinutes,
      checkInTime: siteVisitsTable.checkInTime,
      expiresAt: siteVisitsTable.expiresAt,
    })
    .from(siteVisitsTable)
    .leftJoin(siteLocationsTable, eq(siteLocationsTable.id, siteVisitsTable.siteLocationId))
    .leftJoin(partnersTable, eq(partnersTable.id, siteVisitsTable.hostPartnerId))
    .leftJoin(vendorsTable, eq(vendorsTable.id, siteVisitsTable.hostVendorId))
    .where(and(eq(siteVisitsTable.guestSessionId, ctx.guest.id), isNull(siteVisitsTable.checkOutTime)))
    .orderBy(desc(siteVisitsTable.checkInTime))
    .limit(1);
  res.json(active ?? null);
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
  if (!await enforceVisitsRateLimit(req, res, session)) return;
  const siteParam = req.query.siteLocationId ? Number(req.query.siteLocationId) : null;
  const fromParam = typeof req.query.from === "string" ? new Date(req.query.from) : null;
  const toParam = typeof req.query.to === "string" ? new Date(req.query.to) : null;
  const conds: any[] = [];
  if (siteParam && Number.isFinite(siteParam)) {
    conds.push(eq(siteVisitsTable.siteLocationId, siteParam));
  }
  if (fromParam && !Number.isNaN(fromParam.getTime())) {
    conds.push(sql`${siteVisitsTable.checkInTime} >= ${fromParam}`);
  }
  if (toParam && !Number.isNaN(toParam.getTime())) {
    conds.push(sql`${siteVisitsTable.checkInTime} <= ${toParam}`);
  }
  if (session.role === "vendor" && session.vendorId) {
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
      purpose: siteVisitsTable.purpose,
      expectedDurationMinutes: siteVisitsTable.expectedDurationMinutes,
      hostType: siteVisitsTable.hostType,
      hostPartnerId: siteVisitsTable.hostPartnerId,
      hostVendorId: siteVisitsTable.hostVendorId,
      hostPartnerName: partnersTable.name,
      hostVendorName: vendorsTable.name,
      siteLocationId: siteVisitsTable.siteLocationId,
      siteName: siteLocationsTable.name,
      checkInTime: siteVisitsTable.checkInTime,
      checkOutTime: siteVisitsTable.checkOutTime,
      autoCheckedOut: siteVisitsTable.autoCheckedOut,
      checkInLatitude: siteVisitsTable.checkInLatitude,
      checkInLongitude: siteVisitsTable.checkInLongitude,
    })
    .from(siteVisitsTable)
    .leftJoin(siteLocationsTable, eq(siteLocationsTable.id, siteVisitsTable.siteLocationId))
    .leftJoin(partnersTable, eq(partnersTable.id, siteVisitsTable.hostPartnerId))
    .leftJoin(vendorsTable, eq(vendorsTable.id, siteVisitsTable.hostVendorId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(siteVisitsTable.checkInTime))
    .limit(500);
  res.json(rows);
});

// ---------- GET /api/visits/:id — staff detail with role-aware access ----------
router.get("/visits/:id", async (req, res): Promise<void> => {
  const session = getStaffSession(req);
  if (!session || session.role === "guest") {
    res.status(401).json({ message: "Login required", code: AUTH_REQUIRED });
    return;
  }
  // Task #698: per-session, role-aware rate limit on the visit
  // detail endpoint. Shares the visits-resource budget with the
  // list/SSE so an attacker sweeping visit ids burns down the same
  // window as one polling the list.
  if (!await enforceVisitsRateLimit(req, res, session)) return;
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
      purpose: siteVisitsTable.purpose,
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
    .leftJoin(siteLocationsTable, eq(siteLocationsTable.id, siteVisitsTable.siteLocationId))
    .leftJoin(partnersTable, eq(partnersTable.id, siteVisitsTable.hostPartnerId))
    .leftJoin(vendorsTable, eq(vendorsTable.id, siteVisitsTable.hostVendorId))
    .where(eq(siteVisitsTable.id, id));
  if (!v) {
    res.status(404).json({ message: "Visit not found", code: VISIT_NOT_FOUND });
    return;
  }
  if (session.role === "vendor" && v.hostVendorId !== session.vendorId) {
    res.status(403).json({ message: "Forbidden", code: VISIT_NO_ACCESS });
    return;
  }
  if (session.role === "partner" && v.sitePartnerId !== session.partnerId) {
    res.status(403).json({ message: "Forbidden", code: VISIT_NO_ACCESS });
    return;
  }
  res.json(v);
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
      .select({ id: siteLocationsTable.id, partnerId: siteLocationsTable.partnerId })
      .from(siteLocationsTable)
      .where(sql`${siteLocationsTable.id} = ANY(${siteIds})`);
    const partnerBySite = new Map(sitePartnerRows.map((r) => [r.id, r.partnerId]));
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
