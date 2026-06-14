import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, isNull, inArray, sql, desc, gte, or, isNotNull } from "drizzle-orm";
import crypto from "crypto";
import {
  db,
  locationConsentsTable,
  gpsLogsTable,
  ticketsTable,
  fieldEmployeesTable,
  siteLocationsTable,
  vendorsTable,
  workTypesTable,
} from "@workspace/db";
import {
  publishLocationEvent,
  subscribeLocationEvents,
  getCurrentLocationEventSeq,
  type PublishedLocationEvent,
} from "../lib/location-events";
import { notifyUsers, findVendorUserIds } from "./notifications";
import { logger } from "../lib/logger";

import { SESSION_SECRET, getSessionFromRequest } from "../lib/session";
import { enforceLiveLocationsRateLimit } from "../lib/live-locations-rate-limit";
import { resolveLiveLocationsScope } from "../lib/live-locations-scope";
import { resolveRecentTripsScope } from "../lib/recent-trips-scope";
import {
  checkInDistanceMeters,
  computeOnSiteMinutes,
  computeTravelMinutes,
  pickReplayDate,
} from "../lib/recent-trips-format";
import {
  LIVE_TRACKED_LIFECYCLE_STATES,
} from "@workspace/ticket-status-meta";
import {
  resolveSiteMapRadiusMeters,
  QUARTER_MILE_METERS,
  MAX_RADIUS_METERS,
} from "@workspace/map-utils";

const COOKIE_NAME = "vndrly_session";
const ACTIVE_LIFECYCLE_STATES = LIVE_TRACKED_LIFECYCLE_STATES;
const LIVE_PING_EVENT = "live_ping" as const;
const LIVE_PING_FRESH_MS = 15 * 60 * 1000;

// Task #57 — dispatcher alert when a crew member's phone battery hits a
// critical level. The crew map already shows a low-battery icon at <=20%
// (`LOW_BATTERY_THRESHOLD` in the web UI), but dispatchers shouldn't have
// to be staring at the map to notice. We fire a single "low_battery"
// notification per low-battery episode — i.e. only when a ping crosses
// from above the threshold to at-or-below, never on consecutive low
// pings — so the inbox doesn't get flooded once a phone settles in the
// red. Re-arms automatically the next time battery climbs back above
// the threshold and dips again. Threshold is configurable via env so
// ops can tune per environment without a code change.
export function parseCriticalBatteryThreshold(raw: string | undefined): number {
  const fallback = 0.1; // 10%
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 1) return fallback;
  return n;
}
export const CRITICAL_BATTERY_THRESHOLD = parseCriticalBatteryThreshold(
  process.env.CRITICAL_BATTERY_THRESHOLD,
);

type Session = { userId: number; role: string; vendorId: number | null; partnerId: number | null };

// ── Heading helpers ─────────────────────────────────────────────────────────
// Distance below which a computed bearing is unreliable (GPS jitter dominates),
// so we report a neutral heading instead of pointing in a random direction.
const STATIONARY_DIST_M = 8;

function toRad(d: number): number { return (d * Math.PI) / 180; }

function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function computeHeading(
  prev: { latitude: number; longitude: number } | null,
  cur: { latitude: number; longitude: number },
): number | null {
  if (!prev) return null;
  if (haversineMeters(prev.latitude, prev.longitude, cur.latitude, cur.longitude) < STATIONARY_DIST_M) {
    return null;
  }
  return bearingDeg(prev.latitude, prev.longitude, cur.latitude, cur.longitude);
}

function sanitizeHeading(raw: unknown): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  // Normalize anything over 360 (some APIs return e.g. 359.9 + jitter).
  return n % 360;
}

// Reject negative or non-finite values; expo-location reports speed as -1
// when unknown. Cap at a sane upper bound (~700 km/h ≈ 195 m/s) so a runaway
// GPS glitch can't produce a "Mach 3" badge on the map.
function sanitizeSpeed(raw: unknown): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n > 200) return null;
  return n;
}

function getSession(req: Request): Session | null {
  const cookie = (req as any).cookies?.[COOKIE_NAME];
  if (!cookie) return null;
  const lastDot = cookie.lastIndexOf(".");
  if (lastDot === -1) return null;
  const payload = cookie.slice(0, lastDot);
  const sig = cookie.slice(lastDot + 1);
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) return null;
  } catch {
    return null;
  }
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

// ── Consent ──
router.get("/location-consents/me", async (req: Request, res: Response) => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ code: "auth.unauthenticated", error: "unauthenticated" });
    return;
  }
  const rows = await db
    .select()
    .from(locationConsentsTable)
    .where(and(eq(locationConsentsTable.userId, session.userId), isNull(locationConsentsTable.revokedAt)));
  res.json({ consents: rows });
});

router.post("/location-consents", async (req: Request, res: Response) => {
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ code: "auth.unauthenticated", error: "unauthenticated" });
    return;
  }
  const deviceId = String(req.body?.deviceId || "").slice(0, 200);
  if (!deviceId) {
    res.status(400).json({ code: "visitor.device_id_required", error: "deviceId required" });
    return;
  }
  if (session.userId == null) {
    res.status(401).json({ code: "auth.unauthenticated", error: "unauthenticated" });
    return;
  }
  const [row] = await db
    .insert(locationConsentsTable)
    .values({ userId: session.userId, deviceId })
    .onConflictDoUpdate({
      target: [locationConsentsTable.userId, locationConsentsTable.deviceId],
      set: { revokedAt: null, acceptedAt: new Date() },
    })
    .returning();
  res.status(200).json(row);
});

router.delete("/location-consents", async (req: Request, res: Response) => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ code: "auth.unauthenticated", error: "unauthenticated" });
    return;
  }
  const deviceId = req.query.deviceId ? String(req.query.deviceId) : null;
  const filters = [eq(locationConsentsTable.userId, session.userId), isNull(locationConsentsTable.revokedAt)];
  if (deviceId) filters.push(eq(locationConsentsTable.deviceId, deviceId));
  await db
    .update(locationConsentsTable)
    .set({ revokedAt: new Date() })
    .where(and(...filters));
  res.status(204).end();
});

// ── Live ping ──
router.post("/location-pings", async (req: Request, res: Response) => {
  const session = getSession(req);
  if (!session || session.role !== "field_employee") {
    res.status(401).json({ code: "auth.unauthenticated", error: "unauthenticated" });
    return;
  }
  const ticketId = Number(req.body?.ticketId);
  const lat = Number(req.body?.latitude);
  const lng = Number(req.body?.longitude);
  const battery = req.body?.batteryLevel == null ? null : Number(req.body.batteryLevel);
  const deviceHeading = sanitizeHeading(req.body?.heading);
  const speedMps = sanitizeSpeed(req.body?.speedMps);
  const deviceId = req.body?.deviceId ? String(req.body.deviceId).slice(0, 200) : "";
  if (!Number.isFinite(ticketId) || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    res.status(400).json({ code: "visitor.coords_required", error: "ticketId, latitude, longitude required" });
    return;
  }
  if (!deviceId) {
    res.status(400).json({ code: "visitor.device_id_required", error: "deviceId required" });
    return;
  }

  // Active consent gate — must match this exact device.
  const [consent] = await db
    .select()
    .from(locationConsentsTable)
    .where(and(
      eq(locationConsentsTable.userId, session.userId),
      eq(locationConsentsTable.deviceId, deviceId),
      isNull(locationConsentsTable.revokedAt),
    ))
    .limit(1);
  if (!consent) {
    res.status(403).json({ code: "visitor.no_active_consent", error: "no_active_consent" });
    return;
  }

  // Validate ticket ownership and on-shift state
  const [emp] = await db
    .select()
    .from(fieldEmployeesTable)
    .where(eq(fieldEmployeesTable.userId, session.userId))
    .limit(1);
  if (!emp) {
    res.status(403).json({ code: "visitor.no_employee_profile", error: "no_employee_profile" });
    return;
  }
  const employeeId = emp.id;

  const [ticket] = await db
    .select()
    .from(ticketsTable)
    .where(eq(ticketsTable.id, ticketId))
    .limit(1);
  if (!ticket || ticket.fieldEmployeeId !== employeeId) {
    res.status(403).json({ code: "visitor.not_ticket_owner", error: "not_ticket_owner" });
    return;
  }
  if (!ticket.lifecycleState || !ACTIVE_LIFECYCLE_STATES.includes(ticket.lifecycleState as any)) {
    res.status(409).json({ code: "visitor.ticket_not_on_shift", error: "ticket_not_on_shift" });
    return;
  }

  // Look up the most recent live_ping for this ticket BEFORE inserting the new
  // one so we can compute a server-side heading when the device didn't supply
  // one. We don't persist heading on gps_logs (no schema change required) —
  // it's recomputed on demand from the previous → current ping.
  const [prevPing] = await db
    .select({
      latitude: gpsLogsTable.latitude,
      longitude: gpsLogsTable.longitude,
      // Task #57 — battery level on the previous ping is the signal we use
      // to detect the "device just crossed below the critical threshold"
      // transition that triggers a single dispatcher alert per episode.
      batteryLevel: gpsLogsTable.batteryLevel,
    })
    .from(gpsLogsTable)
    .where(and(eq(gpsLogsTable.ticketId, ticketId), eq(gpsLogsTable.eventType, LIVE_PING_EVENT)))
    .orderBy(desc(gpsLogsTable.id))
    .limit(1);

  const [created] = await db
    .insert(gpsLogsTable)
    .values({
      ticketId,
      latitude: lat,
      longitude: lng,
      eventType: LIVE_PING_EVENT,
      batteryLevel: battery == null || Number.isNaN(battery) ? null : battery,
      speedMps,
    })
    .returning();

  const headingForEvent =
    deviceHeading != null
      ? deviceHeading
      : computeHeading(
          prevPing
            ? { latitude: Number(prevPing.latitude), longitude: Number(prevPing.longitude) }
            : null,
          { latitude: Number(created.latitude), longitude: Number(created.longitude) },
        );

  // Fan out a live event so subscribers (e.g. Crew Map) can move the pin
  // without polling /api/live-locations. Site metadata is best-effort —
  // a failed lookup must not suppress the live update.
  let siteName: string | null = null;
  let siteCode: string | null = null;
  let sitePartnerId: number | null = null;
  if (ticket.siteLocationId) {
    try {
      const [site] = await db
        .select({
          name: siteLocationsTable.name,
          siteCode: siteLocationsTable.siteCode,
          partnerId: siteLocationsTable.partnerId,
        })
        .from(siteLocationsTable)
        .where(eq(siteLocationsTable.id, ticket.siteLocationId))
        .limit(1);
      if (site) {
        siteName = site.name ?? null;
        siteCode = site.siteCode ?? null;
        sitePartnerId = site.partnerId ?? null;
      }
    } catch {
      // Continue with null site fields — the ping itself is the priority.
    }
  }
  // Look up the destination site coords too — needed by the crew map to draw
  // a route line and compute distance/ETA. Best-effort; a failed lookup must
  // not suppress the live ping itself.
  let siteLatitude: number | null = null;
  let siteLongitude: number | null = null;
  if (ticket.siteLocationId) {
    try {
      const [coords] = await db
        .select({
          latitude: siteLocationsTable.latitude,
          longitude: siteLocationsTable.longitude,
        })
        .from(siteLocationsTable)
        .where(eq(siteLocationsTable.id, ticket.siteLocationId))
        .limit(1);
      if (coords) {
        siteLatitude = coords.latitude == null ? null : Number(coords.latitude);
        siteLongitude = coords.longitude == null ? null : Number(coords.longitude);
      }
    } catch {
      // Continue with null site coords.
    }
  }
  try {
    publishLocationEvent({
      type: "location.ping",
      location: {
        employeeId,
        employeeName:
          [emp.firstName, emp.lastName].filter(Boolean).join(" ") ||
          `Employee #${employeeId}`,
        ticketId,
        vendorId: ticket.vendorId ?? null,
        lifecycleState: ticket.lifecycleState ?? null,
        siteLocationId: ticket.siteLocationId ?? null,
        sitePartnerId,
        siteName,
        siteCode,
        siteLatitude,
        siteLongitude,
        latitude: Number(created.latitude),
        longitude: Number(created.longitude),
        batteryLevel:
          created.batteryLevel == null ? null : Number(created.batteryLevel),
        heading: headingForEvent,
        speedMps: created.speedMps == null ? null : Number(created.speedMps),
        recordedAt: (created.recordedAt ?? new Date()).toISOString(),
      },
    });
  } catch {
    // Never fail the ping write because the broadcast hiccupped.
  }

  // Task #57 — dispatcher low-battery alert. Fires only on the descent
  // edge into the critical-battery range (prev ping was above the
  // threshold or had no battery reading) so dispatchers get one ping per
  // episode, not one per location update once the phone is already in
  // the red. The notification system itself also dedupes on
  // `(userId, dedupeKey)`, and we key by the new gps_logs row id so even
  // an at-most-once delivery quirk can't double-send for the same edge.
  // Wrapped in try/catch and best-effort — a notification failure must
  // never block the location ping write itself.
  try {
    const curBattery =
      created.batteryLevel == null ? null : Number(created.batteryLevel);
    const prevBattery =
      prevPing && prevPing.batteryLevel != null
        ? Number(prevPing.batteryLevel)
        : null;
    const isCriticalNow =
      curBattery != null && curBattery <= CRITICAL_BATTERY_THRESHOLD;
    // Re-arm only when this is the first-ever ping for the ticket OR the
    // previous ping had an *explicit* reading above the threshold (i.e. a
    // real charge recovery). A previous ping with `batteryLevel: null` is
    // an unknown state — treating it as "above threshold" would cause
    // sequences like low → null → low to fire a duplicate alert inside a
    // single unresolved episode, which violates the once-per-episode
    // guarantee. Conservative interpretation: don't fire on null-prev.
    const wasAboveThreshold =
      !prevPing ||
      (prevBattery != null && prevBattery > CRITICAL_BATTERY_THRESHOLD);
    if (isCriticalNow && wasAboveThreshold && ticket.vendorId) {
      const recipients = await findVendorUserIds(ticket.vendorId);
      if (recipients.length > 0) {
        const empName =
          [emp.firstName, emp.lastName].filter(Boolean).join(" ").trim() ||
          `Employee #${employeeId}`;
        const pct = Math.max(0, Math.round((curBattery as number) * 100));
        await notifyUsers(recipients, {
          type: "low_battery",
          category: "crew",
          title: "Crew battery is critically low",
          body: `${empName}'s phone battery is at ${pct}%. They may go offline soon.`,
          link: `/crew-map`,
          // Per-episode dedupe — the edge ping's id is unique forever, so
          // every distinct descent into the critical range gets its own
          // key while the matching `notifyUsers` `onConflictDoNothing`
          // guards against the rare retry double-send.
          dedupeKey: `low_battery:${employeeId}:${created.id}`,
          pushData: { employeeId, ticketId, type: "low_battery" },
        });
      }
    }
  } catch (err) {
    logger.warn(
      { err, ticketId, employeeId },
      "low-battery notification dispatch failed",
    );
  }

  res.status(201).json(created);
});

// ── Live locations (vendor / admin) ──
router.get("/live-locations", async (req: Request, res: Response) => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ code: "auth.unauthenticated", error: "unauthenticated" });
    return;
  }
  // Per-session, role-aware rate limit on the polled fleet-map
  // fallback endpoint (Task #698, registered into the multi-endpoint
  // admin readout by Task #697). Applied BEFORE the joined "latest
  // ping per ticket" query so an attacker sweeping vendor or site
  // filters also gets throttled rather than triggering the aggregate
  // four-table join on every probe.
  if (!await enforceLiveLocationsRateLimit(req, res, session)) return;
  const filterVendorId = req.query.vendorId ? Number(req.query.vendorId) : null;
  const filterSiteLocationId = req.query.siteLocationId ? Number(req.query.siteLocationId) : null;
  if (req.query.siteLocationId && !Number.isFinite(filterSiteLocationId)) {
    res.status(400).json({ code: "visitor.invalid_site_location_id", error: "invalid_siteLocationId" });
    return;
  }
  const scope = resolveLiveLocationsScope(session, filterVendorId);
  if (!scope.ok) {
    res.status(scope.status).json(scope.body);
    return;
  }
  const scopedVendorId = scope.scopedVendorId;

  const sinceTs = new Date(Date.now() - LIVE_PING_FRESH_MS);
  const ticketFilters = [
    inArray(ticketsTable.lifecycleState, ACTIVE_LIFECYCLE_STATES as unknown as string[]),
  ];
  if (scopedVendorId) ticketFilters.push(eq(ticketsTable.vendorId, scopedVendorId));
  if (filterSiteLocationId) ticketFilters.push(eq(ticketsTable.siteLocationId, filterSiteLocationId));

  // Latest live_ping per ticket in freshness window — proper "latest per group"
  // via inner join against per-ticket max(id), filtered to live_ping events only.
  const latestPings = await db.execute(sql`
    select g.ticket_id        as "ticketId",
           g.latitude         as "latitude",
           g.longitude        as "longitude",
           g.battery_level    as "batteryLevel",
           g.speed_mps        as "speedMps",
           g.recorded_at      as "recordedAt"
      from ${gpsLogsTable} g
      join (
        select ticket_id, max(id) as max_id
          from ${gpsLogsTable}
         where event_type = ${LIVE_PING_EVENT}
           and recorded_at >= ${sinceTs}
         group by ticket_id
      ) latest on latest.ticket_id = g.ticket_id and latest.max_id = g.id
  `);
  const byTicket = new Map<number, {
    ticketId: number; latitude: number; longitude: number;
    batteryLevel: number | null; speedMps: number | null;
    recordedAt: Date;
    heading: number | null;
  }>();
  for (const r of latestPings.rows as any[]) {
    byTicket.set(Number(r.ticketId), {
      ticketId: Number(r.ticketId),
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      batteryLevel: r.batteryLevel == null ? null : Number(r.batteryLevel),
      speedMps: r.speedMps == null ? null : Number(r.speedMps),
      recordedAt: new Date(r.recordedAt),
      heading: null,
    });
  }
  // Pull the previous live_ping per ticket (the one immediately before the
  // current latest) so we can derive a direction-of-travel bearing without
  // requiring the device to send heading. We don't persist heading on
  // gps_logs, so this re-derivation happens on every read.
  if (byTicket.size > 0) {
    try {
      const prevPings = await db.execute(sql`
        select g.ticket_id     as "ticketId",
               g.latitude      as "latitude",
               g.longitude     as "longitude"
          from ${gpsLogsTable} g
          join (
            select ticket_id,
                   (array_agg(id order by id desc))[2] as prev_id
              from ${gpsLogsTable}
             where event_type = ${LIVE_PING_EVENT}
               and recorded_at >= ${sinceTs}
             group by ticket_id
          ) prev on prev.ticket_id = g.ticket_id and prev.prev_id = g.id
      `);
      for (const r of prevPings.rows as any[]) {
        const tid = Number(r.ticketId);
        const cur = byTicket.get(tid);
        if (!cur) continue;
        cur.heading = computeHeading(
          { latitude: Number(r.latitude), longitude: Number(r.longitude) },
          { latitude: cur.latitude, longitude: cur.longitude },
        );
      }
    } catch {
      // If the previous-ping query fails (older Postgres, etc.), the latest
      // pings still render — just without a heading arrow.
    }
  }
  const ticketIds = Array.from(byTicket.keys());
  if (ticketIds.length === 0) {
    res.json({ locations: [] });
    return;
  }

  const tickets = await db
    .select({
      ticketId: ticketsTable.id,
      vendorId: ticketsTable.vendorId,
      lifecycleState: ticketsTable.lifecycleState,
      fieldEmployeeId: ticketsTable.fieldEmployeeId,
      empFirst: fieldEmployeesTable.firstName,
      empLast: fieldEmployeesTable.lastName,
      siteName: siteLocationsTable.name,
      siteCode: siteLocationsTable.siteCode,
      siteLatitude: siteLocationsTable.latitude,
      siteLongitude: siteLocationsTable.longitude,
    })
    .from(ticketsTable)
    .leftJoin(fieldEmployeesTable, eq(fieldEmployeesTable.id, ticketsTable.fieldEmployeeId))
    .leftJoin(siteLocationsTable, eq(siteLocationsTable.id, ticketsTable.siteLocationId))
    .where(and(inArray(ticketsTable.id, ticketIds), ...ticketFilters));

  const out = tickets
    .map((t) => {
      const ping = byTicket.get(t.ticketId);
      if (!ping || !t.fieldEmployeeId) return null;
      return {
        employeeId: t.fieldEmployeeId,
        employeeName: [t.empFirst, t.empLast].filter(Boolean).join(" ") || `Employee #${t.fieldEmployeeId}`,
        ticketId: t.ticketId,
        vendorId: t.vendorId,
        lifecycleState: t.lifecycleState,
        siteName: t.siteName,
        siteCode: t.siteCode,
        siteLatitude: t.siteLatitude == null ? null : Number(t.siteLatitude),
        siteLongitude: t.siteLongitude == null ? null : Number(t.siteLongitude),
        latitude: ping.latitude,
        longitude: ping.longitude,
        batteryLevel: ping.batteryLevel,
        heading: ping.heading,
        speedMps: ping.speedMps,
        recordedAt: ping.recordedAt,
      };
    })
    .filter(Boolean);

  // Reduce to one entry per employee (most recent across tickets).
  const byEmp = new Map<number, NonNullable<(typeof out)[number]>>();
  for (const row of out) {
    if (!row) continue;
    const cur = byEmp.get(row.employeeId);
    if (!cur || row.recordedAt > cur.recordedAt) byEmp.set(row.employeeId, row);
  }
  res.json({ locations: Array.from(byEmp.values()) });
});

// ── Live location stream (SSE) ──
router.get("/live-locations/events", async (req: Request, res: Response): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ code: "auth.unauthenticated", error: "unauthenticated" });
    return;
  }
  // Per-session, role-aware rate limit on the SSE live-locations
  // stream (Task #698, registered into the multi-endpoint admin
  // readout by Task #697). Enforced once per (re)connect — the
  // limiter charges one hit per `connect` attempt, not per streamed
  // event, so a healthy long-lived stream costs exactly one slot;
  // only a tab stuck in a reconnect loop trips the budget, just
  // like the REST fallback above.
  if (!await enforceLiveLocationsRateLimit(req, res, session)) return;
  const filterVendorId = req.query.vendorId ? Number(req.query.vendorId) : null;
  const filterSiteLocationId = req.query.siteLocationId
    ? Number(req.query.siteLocationId)
    : null;
  if (req.query.siteLocationId && !Number.isFinite(filterSiteLocationId)) {
    res.status(400).json({ code: "visitor.invalid_site_location_id", error: "invalid_siteLocationId" });
    return;
  }
  // Mirror /api/live-locations role gating exactly so the SSE stream and
  // the REST fallback expose the same set of pings to a given session.
  const scope = resolveLiveLocationsScope(session, filterVendorId);
  if (!scope.ok) {
    res.status(scope.status).json(scope.body);
    return;
  }
  const scopedVendorId = scope.scopedVendorId;

  const visible = (ev: PublishedLocationEvent): boolean => {
    const loc = ev.location;
    if (!ACTIVE_LIFECYCLE_STATES.includes(loc.lifecycleState as any)) return false;
    if (scopedVendorId && loc.vendorId !== scopedVendorId) return false;
    if (filterSiteLocationId && loc.siteLocationId !== filterSiteLocationId) return false;
    return true;
  };

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();
  res.write(`: connected\n\n`);

  // EventSource auto-includes Last-Event-ID on reconnect when prior events
  // wrote `id:` lines. Compare the client's last seen seq against the current
  // global seq so we can warn the client they may have missed pings while
  // disconnected. (Only set the gap flag when we actually have a prior id —
  // an initial connection with no history isn't a gap.)
  const lastEventIdHeader = req.header("Last-Event-ID");
  const lastSeenSeqRaw = lastEventIdHeader != null ? Number(lastEventIdHeader) : NaN;
  const lastSeenSeq = Number.isFinite(lastSeenSeqRaw) ? lastSeenSeqRaw : null;
  void getCurrentLocationEventSeq()
    .then((currentSeq) => {
      const gap = lastSeenSeq != null && currentSeq > lastSeenSeq;
      const hello = {
        type: "location.hello" as const,
        currentSeq,
        lastSeenSeq,
        gap,
      };
      try {
        res.write(`event: location.hello\n`);
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

  const unsubscribe = subscribeLocationEvents((ev) => {
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

// ── Per-employee day playback ──
router.get("/field-employees/:id/day-track", async (req: Request, res: Response) => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ code: "auth.unauthenticated", error: "unauthenticated" });
    return;
  }
  const employeeId = Number(req.params.id);
  if (!Number.isFinite(employeeId)) {
    res.status(400).json({ code: "visitor.invalid_id", error: "invalid_id" });
    return;
  }
  const dateStr = req.query.date ? String(req.query.date) : new Date().toISOString().slice(0, 10);
  const start = new Date(`${dateStr}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) {
    res.status(400).json({ code: "visitor.invalid_date", error: "invalid_date" });
    return;
  }
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  const [emp] = await db
    .select()
    .from(fieldEmployeesTable)
    .where(eq(fieldEmployeesTable.id, employeeId))
    .limit(1);
  if (!emp) {
    res.status(404).json({ code: "visitor.not_found", error: "not_found" });
    return;
  }
  if (session.role === "vendor") {
    if (session.vendorId !== emp.vendorId) {
      res.status(403).json({ code: "visitor.wrong_vendor", error: "wrong_vendor" });
      return;
    }
  } else if (session.role === "field_employee") {
    const isForeman =
      (session as { vendorRole?: string | null }).vendorRole === "foreman" ||
      (session as { vendorRole?: string | null }).vendorRole === "both";
    if (!isForeman || !session.vendorId || session.vendorId !== emp.vendorId) {
      res.status(403).json({ code: "visitor.forbidden", error: "forbidden" });
      return;
    }
  } else if (session.role === "partner") {
    if (!session.partnerId) {
      res.status(403).json({ code: "visitor.no_partner", error: "no_partner" });
      return;
    }
    const [scoped] = await db
      .select({ id: gpsLogsTable.id })
      .from(gpsLogsTable)
      .innerJoin(ticketsTable, eq(ticketsTable.id, gpsLogsTable.ticketId))
      .innerJoin(siteLocationsTable, eq(siteLocationsTable.id, ticketsTable.siteLocationId))
      .where(
        and(
          eq(ticketsTable.fieldEmployeeId, employeeId),
          eq(siteLocationsTable.partnerId, session.partnerId),
          gte(gpsLogsTable.recordedAt, start),
          sql`${gpsLogsTable.recordedAt} < ${end}`,
        ),
      )
      .limit(1);
    if (!scoped) {
      res.status(403).json({ code: "visitor.forbidden", error: "forbidden" });
      return;
    }
  } else if (session.role !== "admin") {
    res.status(403).json({ code: "visitor.forbidden", error: "forbidden" });
    return;
  }

  const pings = await db
    .select({
      id: gpsLogsTable.id,
      ticketId: gpsLogsTable.ticketId,
      latitude: gpsLogsTable.latitude,
      longitude: gpsLogsTable.longitude,
      eventType: gpsLogsTable.eventType,
      batteryLevel: gpsLogsTable.batteryLevel,
      recordedAt: gpsLogsTable.recordedAt,
    })
    .from(gpsLogsTable)
    .innerJoin(ticketsTable, eq(ticketsTable.id, gpsLogsTable.ticketId))
    .where(
      and(
        eq(ticketsTable.fieldEmployeeId, employeeId),
        gte(gpsLogsTable.recordedAt, start),
        sql`${gpsLogsTable.recordedAt} < ${end}`,
      ),
    )
    .orderBy(gpsLogsTable.recordedAt);

  res.json({
    employee: { id: emp.id, name: `${emp.firstName ?? ""} ${emp.lastName ?? ""}`.trim() },
    date: dateStr,
    pings,
  });
});

// ── Recent site trips (role-scoped audit / dispute reference) ───────────────
router.get("/map/recent-trips", async (req: Request, res: Response): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ code: "auth.unauthenticated", error: "unauthenticated" });
    return;
  }

  const filterVendorId = req.query.vendorId ? Number(req.query.vendorId) : null;
  const filterSiteLocationId = req.query.siteLocationId
    ? Number(req.query.siteLocationId)
    : null;
  if (req.query.siteLocationId && !Number.isFinite(filterSiteLocationId)) {
    res.status(400).json({ code: "visitor.invalid_site_location_id", error: "invalid_siteLocationId" });
    return;
  }

  let limit = req.query.limit ? Number(req.query.limit) : 100;
  if (!Number.isFinite(limit) || limit <= 0) limit = 100;
  if (limit > 100) limit = 100;

  const scope = resolveRecentTripsScope(session, {
    vendorId: filterVendorId,
    siteLocationId: filterSiteLocationId,
  });
  if (!scope.ok) {
    res.status(scope.status).json(scope.body);
    return;
  }

  if (scope.partnerId && filterSiteLocationId) {
    const [site] = await db
      .select({ partnerId: siteLocationsTable.partnerId })
      .from(siteLocationsTable)
      .where(eq(siteLocationsTable.id, filterSiteLocationId));
    if (!site || site.partnerId !== scope.partnerId) {
      res.status(403).json({ code: "visitor.forbidden", error: "forbidden" });
      return;
    }
  }

  const tripActivity = or(
    isNotNull(ticketsTable.enRouteAt),
    isNotNull(ticketsTable.arrivedAt),
    isNotNull(ticketsTable.checkInTime),
    isNotNull(ticketsTable.onLocationAt),
  );

  const filters = [
    isNotNull(ticketsTable.fieldEmployeeId),
    tripActivity,
  ];
  if (scope.vendorId) filters.push(eq(ticketsTable.vendorId, scope.vendorId));
  if (scope.partnerId) {
    filters.push(eq(siteLocationsTable.partnerId, scope.partnerId));
  }
  if (filterSiteLocationId) {
    filters.push(eq(ticketsTable.siteLocationId, filterSiteLocationId));
  }

  const rows = await db
    .select({
      ticketId: ticketsTable.id,
      employeeId: ticketsTable.fieldEmployeeId,
      empFirst: fieldEmployeesTable.firstName,
      empLast: fieldEmployeesTable.lastName,
      vendorId: ticketsTable.vendorId,
      vendorName: vendorsTable.name,
      siteLocationId: ticketsTable.siteLocationId,
      siteName: siteLocationsTable.name,
      siteCode: siteLocationsTable.siteCode,
      workTypeName: workTypesTable.name,
      lifecycleState: ticketsTable.lifecycleState,
      status: ticketsTable.status,
      enRouteAt: ticketsTable.enRouteAt,
      onLocationAt: ticketsTable.onLocationAt,
      arrivedAt: ticketsTable.arrivedAt,
      checkInTime: ticketsTable.checkInTime,
      checkOutTime: ticketsTable.checkOutTime,
      checkInLatitude: ticketsTable.checkInLatitude,
      checkInLongitude: ticketsTable.checkInLongitude,
      checkOutLatitude: ticketsTable.checkOutLatitude,
      checkOutLongitude: ticketsTable.checkOutLongitude,
      siteLatitude: siteLocationsTable.latitude,
      siteLongitude: siteLocationsTable.longitude,
      siteRadiusMeters: siteLocationsTable.siteRadiusMeters,
      updatedAt: ticketsTable.updatedAt,
    })
    .from(ticketsTable)
    .innerJoin(fieldEmployeesTable, eq(fieldEmployeesTable.id, ticketsTable.fieldEmployeeId))
    .leftJoin(siteLocationsTable, eq(siteLocationsTable.id, ticketsTable.siteLocationId))
    .leftJoin(vendorsTable, eq(vendorsTable.id, ticketsTable.vendorId))
    .leftJoin(workTypesTable, eq(workTypesTable.id, ticketsTable.workTypeId))
    .where(and(...filters))
    .orderBy(
      desc(ticketsTable.checkOutTime),
      desc(ticketsTable.checkInTime),
      desc(ticketsTable.arrivedAt),
      desc(ticketsTable.enRouteAt),
      desc(ticketsTable.updatedAt),
    )
    .limit(limit);

  const ticketIds = rows.map((r) => r.ticketId);
  const pingCounts = new Map<number, number>();
  if (ticketIds.length > 0) {
    const counts = await db.execute(sql`
      select ticket_id as "ticketId", count(*)::int as "cnt"
        from ${gpsLogsTable}
       where ticket_id in (${sql.join(ticketIds.map((id) => sql`${id}`), sql`, `)})
       group by ticket_id
    `);
    for (const r of counts.rows as any[]) {
      pingCounts.set(Number(r.ticketId), Number(r.cnt));
    }
  }

  const trips = rows.map((r) => {
    const lastActivityAt =
      r.checkOutTime ??
      r.checkInTime ??
      r.arrivedAt ??
      r.onLocationAt ??
      r.enRouteAt ??
      r.updatedAt;
    const checkInLat = r.checkInLatitude == null ? null : Number(r.checkInLatitude);
    const checkInLng = r.checkInLongitude == null ? null : Number(r.checkInLongitude);
    const siteLat = r.siteLatitude == null ? null : Number(r.siteLatitude);
    const siteLng = r.siteLongitude == null ? null : Number(r.siteLongitude);
    return {
      ticketId: r.ticketId,
      employeeId: r.employeeId,
      employeeName:
        [r.empFirst, r.empLast].filter(Boolean).join(" ") ||
        `Employee #${r.employeeId}`,
      vendorId: r.vendorId,
      vendorName: r.vendorName,
      siteLocationId: r.siteLocationId,
      siteName: r.siteName,
      siteCode: r.siteCode,
      workTypeName: r.workTypeName,
      lifecycleState: r.lifecycleState,
      status: r.status,
      enRouteAt: r.enRouteAt?.toISOString() ?? null,
      onLocationAt: r.onLocationAt?.toISOString() ?? null,
      arrivedAt: r.arrivedAt?.toISOString() ?? null,
      checkInTime: r.checkInTime?.toISOString() ?? null,
      checkOutTime: r.checkOutTime?.toISOString() ?? null,
      checkInLatitude: checkInLat,
      checkInLongitude: checkInLng,
      checkOutLatitude:
        r.checkOutLatitude == null ? null : Number(r.checkOutLatitude),
      checkOutLongitude:
        r.checkOutLongitude == null ? null : Number(r.checkOutLongitude),
      siteLatitude: siteLat,
      siteLongitude: siteLng,
      siteRadiusMeters:
        r.siteRadiusMeters == null ? null : Number(r.siteRadiusMeters),
      lastActivityAt: lastActivityAt?.toISOString() ?? null,
      onSiteMinutes: computeOnSiteMinutes(r),
      travelMinutes: computeTravelMinutes(r),
      checkInDistanceMeters: checkInDistanceMeters({
        checkInLatitude: checkInLat,
        checkInLongitude: checkInLng,
        siteLatitude: siteLat,
        siteLongitude: siteLng,
      }),
      replayDate: pickReplayDate(
        r.checkInTime,
        r.enRouteAt,
        r.arrivedAt,
        r.updatedAt,
      ),
      gpsPingCount: pingCounts.get(r.ticketId) ?? 0,
    };
  });

  res.json({ trips, limit });
});

// ── Site Map: nearby field employees (partner / admin) ─────────────────────
// Returns the latest live ping per field employee whose most recent reported
// location falls within `radiusMeters` of the requested site location, even
// when they are NOT checked in to a ticket at that site. Each row also
// carries any currently-active ticket info so the UI can show "current
// visit" details on hover when the employee happens to be signed in.
//
// Auth: admin sees any site; partner sees only sites they own (matched by
// session.partnerId == site.partnerId). All other roles get 403.

router.get("/site-map/overview", async (req: Request, res: Response): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ code: "auth.unauthenticated", error: "unauthenticated" });
    return;
  }
  if (session.role === "partner") {
    if (!session.partnerId) {
      res.status(403).json({ code: "visitor.forbidden", error: "forbidden" });
      return;
    }
  } else if (session.role !== "admin") {
    res.status(403).json({ code: "visitor.forbidden", error: "forbidden" });
    return;
  }

  const siteRows = await db
    .select({
      id: siteLocationsTable.id,
      partnerId: siteLocationsTable.partnerId,
      name: siteLocationsTable.name,
      address: siteLocationsTable.address,
      latitude: siteLocationsTable.latitude,
      longitude: siteLocationsTable.longitude,
      siteCode: siteLocationsTable.siteCode,
      siteRadiusMeters: siteLocationsTable.siteRadiusMeters,
    })
    .from(siteLocationsTable)
    .where(
      session.role === "partner"
        ? eq(siteLocationsTable.partnerId, session.partnerId!)
        : sql`true`,
    );

  const sites = siteRows
    .map((s) => ({
      id: s.id,
      name: s.name,
      address: s.address,
      latitude: s.latitude == null ? null : Number(s.latitude),
      longitude: s.longitude == null ? null : Number(s.longitude),
      siteCode: s.siteCode,
      partnerId: s.partnerId,
      siteRadiusMeters: s.siteRadiusMeters == null ? null : Number(s.siteRadiusMeters),
    }))
    .filter(
      (s) =>
        s.latitude != null &&
        s.longitude != null &&
        Number.isFinite(s.latitude) &&
        Number.isFinite(s.longitude),
    );

  if (sites.length === 0) {
    res.json({ sites: [], employees: [] });
    return;
  }

  const sinceTs = new Date(Date.now() - LIVE_PING_FRESH_MS);
  const latestPings = await db.execute(sql`
    select g.ticket_id        as "ticketId",
           g.latitude         as "latitude",
           g.longitude        as "longitude",
           g.battery_level    as "batteryLevel",
           g.speed_mps        as "speedMps",
           g.recorded_at      as "recordedAt"
      from ${gpsLogsTable} g
      join (
        select ticket_id, max(id) as max_id
          from ${gpsLogsTable}
         where event_type = ${LIVE_PING_EVENT}
           and recorded_at >= ${sinceTs}
         group by ticket_id
      ) latest on latest.ticket_id = g.ticket_id and latest.max_id = g.id
  `);

  type Ping = {
    ticketId: number;
    latitude: number;
    longitude: number;
    batteryLevel: number | null;
    speedMps: number | null;
    recordedAt: Date;
  };
  const byTicket = new Map<number, Ping>();
  for (const r of latestPings.rows as any[]) {
    byTicket.set(Number(r.ticketId), {
      ticketId: Number(r.ticketId),
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      batteryLevel: r.batteryLevel == null ? null : Number(r.batteryLevel),
      speedMps: r.speedMps == null ? null : Number(r.speedMps),
      recordedAt: new Date(r.recordedAt),
    });
  }

  const ticketIds = Array.from(byTicket.keys());
  if (ticketIds.length === 0) {
    res.json({
      sites: sites.map((s) => ({
        ...s,
        nearbyCount: 0,
        radiusMeters: resolveSiteMapRadiusMeters(s.siteRadiusMeters),
      })),
      employees: [],
    });
    return;
  }

  const tickets = await db
    .select({
      ticketId: ticketsTable.id,
      lifecycleState: ticketsTable.lifecycleState,
      fieldEmployeeId: ticketsTable.fieldEmployeeId,
      empFirst: fieldEmployeesTable.firstName,
      empLast: fieldEmployeesTable.lastName,
    })
    .from(ticketsTable)
    .leftJoin(fieldEmployeesTable, eq(fieldEmployeesTable.id, ticketsTable.fieldEmployeeId))
    .where(inArray(ticketsTable.id, ticketIds));

  type EmpRow = {
    employeeId: number;
    employeeName: string;
    latitude: number;
    longitude: number;
    nearestSiteId: number;
    distanceMeters: number;
    batteryLevel: number | null;
    speedMps: number | null;
    recordedAt: string;
    lifecycleState: string | null;
    ticketId: number;
  };
  const byEmp = new Map<number, EmpRow>();

  for (const t of tickets) {
    const ping = byTicket.get(t.ticketId);
    if (!ping || !t.fieldEmployeeId) continue;
    let nearestSiteId = sites[0]!.id;
    let nearestDist = Infinity;
    for (const site of sites) {
      const d = haversineMeters(
        ping.latitude,
        ping.longitude,
        site.latitude!,
        site.longitude!,
      );
      const radius = resolveSiteMapRadiusMeters(site.siteRadiusMeters);
      if (d <= radius && d < nearestDist) {
        nearestDist = d;
        nearestSiteId = site.id;
      }
    }
    if (nearestDist === Infinity) continue;
    const candidate: EmpRow = {
      employeeId: t.fieldEmployeeId,
      employeeName:
        [t.empFirst, t.empLast].filter(Boolean).join(" ") ||
        `Employee #${t.fieldEmployeeId}`,
      latitude: ping.latitude,
      longitude: ping.longitude,
      nearestSiteId,
      distanceMeters: nearestDist,
      batteryLevel: ping.batteryLevel,
      speedMps: ping.speedMps,
      recordedAt: ping.recordedAt.toISOString(),
      lifecycleState: t.lifecycleState,
      ticketId: t.ticketId,
    };
    const existing = byEmp.get(candidate.employeeId);
    if (!existing || new Date(candidate.recordedAt) > new Date(existing.recordedAt)) {
      byEmp.set(candidate.employeeId, candidate);
    }
  }

  const employees = Array.from(byEmp.values()).sort(
    (a, b) => a.distanceMeters - b.distanceMeters,
  );

  const nearbyCountBySite = new Map<number, number>();
  for (const emp of employees) {
    nearbyCountBySite.set(
      emp.nearestSiteId,
      (nearbyCountBySite.get(emp.nearestSiteId) ?? 0) + 1,
    );
  }

  res.json({
    sites: sites.map((s) => ({
      ...s,
      nearbyCount: nearbyCountBySite.get(s.id) ?? 0,
      radiusMeters: resolveSiteMapRadiusMeters(s.siteRadiusMeters),
    })),
    employees,
  });
});

router.get("/site-map/:siteLocationId/nearby", async (req: Request, res: Response): Promise<void> => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ code: "auth.unauthenticated", error: "unauthenticated" });
    return;
  }
  const siteId = Number(req.params.siteLocationId);
  if (!Number.isFinite(siteId) || siteId <= 0) {
    res.status(400).json({ code: "visitor.invalid_site_location_id", error: "invalid_siteLocationId" });
    return;
  }
  let radiusMeters = req.query.radiusMeters
    ? Number(req.query.radiusMeters)
    : NaN;

  // Load the site so we can authorize and use its coords as the center.
  const [site] = await db
    .select({
      id: siteLocationsTable.id,
      partnerId: siteLocationsTable.partnerId,
      name: siteLocationsTable.name,
      address: siteLocationsTable.address,
      latitude: siteLocationsTable.latitude,
      longitude: siteLocationsTable.longitude,
      siteCode: siteLocationsTable.siteCode,
      siteRadiusMeters: siteLocationsTable.siteRadiusMeters,
    })
    .from(siteLocationsTable)
    .where(eq(siteLocationsTable.id, siteId));
  if (!site) {
    res.status(404).json({ code: "site.not_found", error: "site_not_found" });
    return;
  }
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) {
    radiusMeters = resolveSiteMapRadiusMeters(
      site.siteRadiusMeters == null ? null : Number(site.siteRadiusMeters),
    );
  }
  if (radiusMeters > MAX_RADIUS_METERS) radiusMeters = MAX_RADIUS_METERS;
  if (session.role === "partner") {
    if (!session.partnerId || session.partnerId !== site.partnerId) {
      res.status(403).json({ code: "visitor.forbidden", error: "forbidden" });
      return;
    }
  } else if (session.role !== "admin") {
    res.status(403).json({ code: "visitor.forbidden", error: "forbidden" });
    return;
  }
  const siteLat = site.latitude == null ? null : Number(site.latitude);
  const siteLng = site.longitude == null ? null : Number(site.longitude);
  if (siteLat == null || siteLng == null) {
    // Site has no coordinates — nothing to spatially compare against.
    res.json({
      site: {
        id: site.id,
        name: site.name,
        address: site.address,
        latitude: null,
        longitude: null,
        siteCode: site.siteCode,
        partnerId: site.partnerId,
      },
      radiusMeters,
      employees: [],
    });
    return;
  }

  // Pull the latest live_ping per ticket within the freshness window.
  // Identical pattern to /api/live-locations so behavior stays consistent.
  const sinceTs = new Date(Date.now() - LIVE_PING_FRESH_MS);
  const latestPings = await db.execute(sql`
    select g.ticket_id        as "ticketId",
           g.latitude         as "latitude",
           g.longitude        as "longitude",
           g.battery_level    as "batteryLevel",
           g.speed_mps        as "speedMps",
           g.recorded_at      as "recordedAt"
      from ${gpsLogsTable} g
      join (
        select ticket_id, max(id) as max_id
          from ${gpsLogsTable}
         where event_type = ${LIVE_PING_EVENT}
           and recorded_at >= ${sinceTs}
         group by ticket_id
      ) latest on latest.ticket_id = g.ticket_id and latest.max_id = g.id
  `);

  type Ping = {
    ticketId: number; latitude: number; longitude: number;
    batteryLevel: number | null; speedMps: number | null;
    recordedAt: Date; heading: number | null;
  };
  const byTicket = new Map<number, Ping>();
  for (const r of latestPings.rows as any[]) {
    byTicket.set(Number(r.ticketId), {
      ticketId: Number(r.ticketId),
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      batteryLevel: r.batteryLevel == null ? null : Number(r.batteryLevel),
      speedMps: r.speedMps == null ? null : Number(r.speedMps),
      recordedAt: new Date(r.recordedAt),
      heading: null,
    });
  }
  // Compute heading from the previous ping (same approach as live-locations).
  if (byTicket.size > 0) {
    try {
      const prevPings = await db.execute(sql`
        select g.ticket_id     as "ticketId",
               g.latitude      as "latitude",
               g.longitude     as "longitude"
          from ${gpsLogsTable} g
          join (
            select ticket_id,
                   (array_agg(id order by id desc))[2] as prev_id
              from ${gpsLogsTable}
             where event_type = ${LIVE_PING_EVENT}
               and recorded_at >= ${sinceTs}
             group by ticket_id
          ) prev on prev.ticket_id = g.ticket_id and prev.prev_id = g.id
      `);
      for (const r of prevPings.rows as any[]) {
        const tid = Number(r.ticketId);
        const cur = byTicket.get(tid);
        if (!cur) continue;
        cur.heading = computeHeading(
          { latitude: Number(r.latitude), longitude: Number(r.longitude) },
          { latitude: cur.latitude, longitude: cur.longitude },
        );
      }
    } catch {
      // Heading is best-effort; skip on failure.
    }
  }
  const ticketIds = Array.from(byTicket.keys());
  if (ticketIds.length === 0) {
    res.json({
      site: {
        id: site.id,
        name: site.name,
        address: site.address,
        latitude: siteLat,
        longitude: siteLng,
        siteCode: site.siteCode,
        partnerId: site.partnerId,
      },
      radiusMeters,
      employees: [],
    });
    return;
  }

  // Resolve each ping's ticket to (employeeId, vendorId, optional active
  // visit info). We pull ALL tickets that produced a recent ping — not only
  // active ones — so we can locate employees who are still reporting GPS
  // even when their last ticket is closed. The "current visit" details
  // (ticketNumber, lifecycleState, siteName) are populated only when the
  // ticket is in an active lifecycle state.
  const tickets = await db
    .select({
      ticketId: ticketsTable.id,
      vendorId: ticketsTable.vendorId,
      lifecycleState: ticketsTable.lifecycleState,
      fieldEmployeeId: ticketsTable.fieldEmployeeId,
      ticketSiteLocationId: ticketsTable.siteLocationId,
      empFirst: fieldEmployeesTable.firstName,
      empLast: fieldEmployeesTable.lastName,
      empVendorId: fieldEmployeesTable.vendorId,
      ticketSiteName: siteLocationsTable.name,
      ticketSiteCode: siteLocationsTable.siteCode,
    })
    .from(ticketsTable)
    .leftJoin(fieldEmployeesTable, eq(fieldEmployeesTable.id, ticketsTable.fieldEmployeeId))
    .leftJoin(siteLocationsTable, eq(siteLocationsTable.id, ticketsTable.siteLocationId))
    .where(inArray(ticketsTable.id, ticketIds));

  type Row = {
    employeeId: number;
    employeeName: string;
    vendorId: number | null;
    latitude: number;
    longitude: number;
    distanceMeters: number;
    batteryLevel: number | null;
    heading: number | null;
    speedMps: number | null;
    recordedAt: Date;
    activeTicket: {
      ticketId: number;
      lifecycleState: string | null;
      siteLocationId: number | null;
      siteName: string | null;
      siteCode: string | null;
    } | null;
  };

  // Reduce to one entry per employee using their MOST RECENT ping. If the
  // most-recent ping is tied to an active-lifecycle ticket, attach the
  // current-visit info. We then filter by radius.
  const byEmp = new Map<number, Row>();
  for (const t of tickets) {
    const ping = byTicket.get(t.ticketId);
    if (!ping || !t.fieldEmployeeId) continue;
    const distanceMeters = haversineMeters(
      ping.latitude,
      ping.longitude,
      siteLat,
      siteLng,
    );
    const isActiveLifecycle =
      t.lifecycleState != null &&
      (ACTIVE_LIFECYCLE_STATES as readonly string[]).includes(t.lifecycleState);
    const candidate: Row = {
      employeeId: t.fieldEmployeeId,
      employeeName:
        [t.empFirst, t.empLast].filter(Boolean).join(" ") ||
        `Employee #${t.fieldEmployeeId}`,
      vendorId: t.vendorId ?? t.empVendorId ?? null,
      latitude: ping.latitude,
      longitude: ping.longitude,
      distanceMeters,
      batteryLevel: ping.batteryLevel,
      heading: ping.heading,
      speedMps: ping.speedMps,
      recordedAt: ping.recordedAt,
      activeTicket: isActiveLifecycle
        ? {
            ticketId: t.ticketId,
            lifecycleState: t.lifecycleState,
            siteLocationId: t.ticketSiteLocationId,
            siteName: t.ticketSiteName,
            siteCode: t.ticketSiteCode,
          }
        : null,
    };
    const existing = byEmp.get(candidate.employeeId);
    if (!existing || candidate.recordedAt > existing.recordedAt) {
      byEmp.set(candidate.employeeId, candidate);
    }
  }

  const employees = Array.from(byEmp.values())
    .filter((r) => r.distanceMeters <= radiusMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .map((r) => ({ ...r, recordedAt: r.recordedAt.toISOString() }));

  res.json({
    site: {
      id: site.id,
      name: site.name,
      address: site.address,
      latitude: siteLat,
      longitude: siteLng,
      siteCode: site.siteCode,
      partnerId: site.partnerId,
      siteRadiusMeters:
        site.siteRadiusMeters == null ? null : Number(site.siteRadiusMeters),
    },
    radiusMeters,
    employees,
  });
});

/** GET /api/site-map/:siteLocationId/compliance-issues — cert gaps for on-site crew. */
router.get(
  "/site-map/:siteLocationId/compliance-issues",
  async (req: Request, res: Response): Promise<void> => {
    const session = getSession(req);
    if (!session) {
      res.status(401).json({ code: "auth.unauthenticated", error: "unauthenticated" });
      return;
    }
    const siteId = Number(req.params.siteLocationId);
    if (!Number.isFinite(siteId) || siteId <= 0) {
      res.status(400).json({ code: "visitor.invalid_site_location_id", error: "invalid_siteLocationId" });
      return;
    }
    const limit = req.query.limit ? Math.min(Number(req.query.limit), 50) : 5;

    const [site] = await db
      .select({
        id: siteLocationsTable.id,
        partnerId: siteLocationsTable.partnerId,
      })
      .from(siteLocationsTable)
      .where(eq(siteLocationsTable.id, siteId));
    if (!site) {
      res.status(404).json({ code: "site.not_found", error: "site_not_found" });
      return;
    }
    const { assertSiteMapPartnerAccess, buildSiteMapComplianceIssues } = await import(
      "../lib/site-map-compliance"
    );
    const allowed = await assertSiteMapPartnerAccess(session, site.partnerId);
    if (!allowed) {
      res.status(403).json({ code: "visitor.forbidden", error: "forbidden" });
      return;
    }

    const activeTickets = await db
      .select({
        ticketId: ticketsTable.id,
        lifecycleState: ticketsTable.lifecycleState,
        employeeId: fieldEmployeesTable.id,
        employeeName: sql<string>`trim(coalesce(${fieldEmployeesTable.firstName}, '') || ' ' || coalesce(${fieldEmployeesTable.lastName}, ''))`,
        vendorName: vendorsTable.name,
      })
      .from(ticketsTable)
      .innerJoin(fieldEmployeesTable, eq(ticketsTable.fieldEmployeeId, fieldEmployeesTable.id))
      .leftJoin(vendorsTable, eq(ticketsTable.vendorId, vendorsTable.id))
      .where(
        and(
          eq(ticketsTable.siteLocationId, siteId),
          inArray(ticketsTable.lifecycleState, [...ACTIVE_LIFECYCLE_STATES]),
        ),
      );

    const issues = await buildSiteMapComplianceIssues({
      siteLocationId: siteId,
      employees: activeTickets.map((row) => ({
        employeeId: row.employeeId,
        employeeName: row.employeeName?.trim() || `Employee #${row.employeeId}`,
        vendorName: row.vendorName,
        activeTicket: {
          ticketId: row.ticketId,
          lifecycleState: row.lifecycleState,
        },
      })),
      limit: Number.isFinite(limit) ? limit : 5,
    });

    res.json({ issues, siteLocationId: siteId });
  },
);

export default router;
