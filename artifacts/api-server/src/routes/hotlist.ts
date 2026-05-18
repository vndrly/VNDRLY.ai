import { Router, type IRouter } from "express";
import { eq, and, desc, isNull, sql } from "drizzle-orm";
import {
  db,
  vendorsTable,
  partnersTable,
  hotlistJobsTable,
  hotlistBidsTable,
  partnerVendorRelationshipsTable,
  ticketsTable,
  siteLocationsTable,
  siteWorkAssignmentsTable,
  workTypesTable,
  vendorWorkTypesTable,
} from "@workspace/db";
import crypto from "crypto";
import { notifyUsers, findPartnerUserIds, findVendorUserIds } from "./notifications";
import { getVendorTier, checkComplianceFloor } from "../lib/vendor-tier";
import { enforceHotlistRateLimit } from "../lib/hotlist-rate-limit";
import { unreadHotlistCommentCountSql } from "../lib/unread-comments";

import { SESSION_SECRET } from "../lib/session";
import { sendApiError } from "../lib/apiError";

const COOKIE_NAME = "vndrly_session";

type Session = { userId: number; role: string; vendorId: number | null; partnerId: number | null; displayName?: string };

function getSession(req: any): Session | null {
  const cookie = req.cookies?.[COOKIE_NAME];
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

async function geocodeOnce(query: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { "User-Agent": "VNDRLY-FieldOps/1.0 (contact: ops@vndrly.com)" } });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ lat: string; lon: string }>;
    if (!data.length) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch (e) {
    console.error("geocode error", e);
    return null;
  }
}

// Generate progressively-broader fallback variants of an address so that
// rural / hard-to-find street addresses still land somewhere reasonable.
function addressFallbacks(address: string): string[] {
  const variants = new Set<string>();
  const cleaned = address.trim().replace(/\s+/g, " ");
  variants.add(cleaned);

  // Strip leading street number+name → keep "City, ST ZIP"
  const cityStateZip = cleaned.match(/([A-Za-z .'-]+,\s*[A-Z]{2}\s*\d{5}(-\d{4})?)/);
  if (cityStateZip) variants.add(cityStateZip[1]);

  // Just the ZIP if present
  const zip = cleaned.match(/\b(\d{5})(-\d{4})?\b/);
  if (zip) variants.add(zip[1]);

  // City + state without ZIP
  const cityState = cleaned.match(/([A-Za-z .'-]+,\s*[A-Z]{2})\b/);
  if (cityState) variants.add(cityState[1]);

  return Array.from(variants);
}

async function geocode(address: string): Promise<{ lat: number; lng: number; usedQuery: string } | null> {
  if (!address || address.trim().length < 4) return null;
  for (const q of addressFallbacks(address)) {
    const r = await geocodeOnce(q);
    if (r) return { ...r, usedQuery: q };
  }
  return null;
}

function distanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const router: IRouter = Router();

// Read vendor operating area (radius + lat/lng + geocoded date).
// Restricted to admin or the owning vendor — coordinates and physical address are sensitive.
router.get("/hotlist/vendors/:id/operating-area", async (req, res) => {
  const session = getSession(req);
  if (!session) return sendApiError(res, 401, "auth.not_authenticated", "Unauthorized");
  const id = parseInt(req.params.id);
  if (isNaN(id)) return sendApiError(res, 400, "validation.invalid_id", "Invalid id");
  if (session.role !== "admin" && !(session.role === "vendor" && session.vendorId === id)) {
    return sendApiError(res, 403, "auth.forbidden", "Forbidden");
  }
  const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, id));
  if (!vendor) return sendApiError(res, 404, "vendor.not_found", "Vendor not found");
  return res.json({
    vendorId: vendor.id,
    operatingRadiusMiles: vendor.operatingRadiusMiles,
    latitude: vendor.latitude,
    longitude: vendor.longitude,
    geocodedAt: vendor.geocodedAt,
    physicalAddress: vendor.physicalAddress,
  });
});

// Update vendor operating area (radius + auto-geocode)
router.patch("/hotlist/vendors/:id/operating-area", async (req, res) => {
  const session = getSession(req);
  if (!session) return sendApiError(res, 401, "auth.not_authenticated", "Unauthorized");
  const id = parseInt(req.params.id);
  if (isNaN(id)) return sendApiError(res, 400, "validation.invalid_id", "Invalid id");
  if (session.role !== "admin" && !(session.role === "vendor" && session.vendorId === id)) {
    return sendApiError(res, 403, "auth.forbidden", "Forbidden");
  }
  const { operatingRadiusMiles, refreshGeocode } = req.body ?? {};
  const radius = operatingRadiusMiles == null ? null : Number(operatingRadiusMiles);
  if (radius != null && (!Number.isFinite(radius) || radius < 0 || radius > 5000)) {
    return sendApiError(res, 400, "hotlist.invalid_radius", "Invalid radius");
  }

  const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, id));
  if (!vendor) return sendApiError(res, 404, "vendor.not_found", "Vendor not found");

  const updates: any = { operatingRadiusMiles: radius };
  let geocodeWarning: string | null = null;
  let geocodeUsedQuery: string | null = null;
  if (refreshGeocode || vendor.latitude == null || vendor.longitude == null) {
    if (vendor.physicalAddress) {
      const geo = await geocode(vendor.physicalAddress);
      if (geo) {
        updates.latitude = geo.lat;
        updates.longitude = geo.lng;
        updates.geocodedAt = new Date();
        if (geo.usedQuery !== vendor.physicalAddress.trim().replace(/\s+/g, " ")) {
          geocodeUsedQuery = geo.usedQuery;
        }
      } else {
        geocodeWarning = `Could not geocode "${vendor.physicalAddress}". Try a simpler address (e.g. "City, ST ZIP") or update the vendor's physical address.`;
      }
    } else {
      geocodeWarning = "Vendor has no physical address. Add one before setting an operating radius.";
    }
  }
  const [updated] = await db.update(vendorsTable).set(updates).where(eq(vendorsTable.id, id)).returning();
  return res.json({ ...updated, geocodeWarning, geocodeUsedQuery });
});

// List hotlist jobs.
// - vendor: only "open" jobs whose location is within their operating radius (requires vendor lat/lng + radius)
// - partner: their own posted jobs (any status)
// - admin: all jobs
router.get("/hotlist/jobs", async (req, res) => {
  const session = getSession(req);
  if (!session) return sendApiError(res, 401, "auth.not_authenticated", "Unauthorized");
  // Task #689: per-session, role-aware rate limit on the hotlist
  // jobs feed. Bid mutations invalidate `["hotlist", "list", …]`
  // queries, so an active job can fan out many list re-fetches in
  // quick succession; the limiter keeps a buggy or scripted client
  // from turning that into a database hot spot.
  if (!await enforceHotlistRateLimit(req, res, session)) return;

  if (session.role === "partner" && session.partnerId) {
    const rows = await db
      .select({
        id: hotlistJobsTable.id,
        partnerId: hotlistJobsTable.partnerId,
        title: hotlistJobsTable.title,
        description: hotlistJobsTable.description,
        locationAddress: hotlistJobsTable.locationAddress,
        latitude: hotlistJobsTable.latitude,
        longitude: hotlistJobsTable.longitude,
        deadline: hotlistJobsTable.deadline,
        estimatedDurationDays: hotlistJobsTable.estimatedDurationDays,
        status: hotlistJobsTable.status,
        awardedBidId: hotlistJobsTable.awardedBidId,
        awardedVendorId: hotlistJobsTable.awardedVendorId,
        convertedTicketId: hotlistJobsTable.convertedTicketId,
        createdAt: hotlistJobsTable.createdAt,
        deletedAt: hotlistJobsTable.deletedAt,
        partnerName: partnersTable.name,
        partnerLogoUrl: partnersTable.logoUrl,
        // Task #51 — unread comment badge for the partner-facing
        // hotlist row. Counts comments this user hasn't seen yet on
        // this job's thread (excluding their own / deleted). Clears
        // automatically once the detail page's thread fetch runs
        // `markAllSeen` and the list re-fetches.
        unreadCommentCount: unreadHotlistCommentCountSql(
          sql`${hotlistJobsTable.id}`,
          session.userId,
        ),
      })
      .from(hotlistJobsTable)
      .leftJoin(partnersTable, eq(hotlistJobsTable.partnerId, partnersTable.id))
      .where(and(eq(hotlistJobsTable.partnerId, session.partnerId), isNull(hotlistJobsTable.deletedAt)))
      .orderBy(desc(hotlistJobsTable.createdAt));
    // attach bid counts
    const ids = rows.map((r) => r.id);
    const counts = ids.length
      ? await db.select({ jobId: hotlistBidsTable.jobId, n: sql<number>`count(*)::int` }).from(hotlistBidsTable).where(sql`${hotlistBidsTable.jobId} IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`).groupBy(hotlistBidsTable.jobId)
      : [];
    const byId: Record<number, number> = {};
    for (const c of counts) byId[c.jobId] = c.n;
    return res.json(rows.map((r) => ({ ...r, bidCount: byId[r.id] ?? 0 })));
  }

  if (session.role === "vendor" && session.vendorId) {
    const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, session.vendorId));
    if (!vendor || vendor.latitude == null || vendor.longitude == null || vendor.operatingRadiusMiles == null) {
      return res.json({ jobs: [], reason: "missing_operating_area", vendor: vendor ? { latitude: vendor.latitude, longitude: vendor.longitude, operatingRadiusMiles: vendor.operatingRadiusMiles } : null });
    }
    // get open jobs with lat/lng
    const openJobs = await db
      .select({
        id: hotlistJobsTable.id,
        partnerId: hotlistJobsTable.partnerId,
        title: hotlistJobsTable.title,
        description: hotlistJobsTable.description,
        locationAddress: hotlistJobsTable.locationAddress,
        latitude: hotlistJobsTable.latitude,
        longitude: hotlistJobsTable.longitude,
        deadline: hotlistJobsTable.deadline,
        estimatedDurationDays: hotlistJobsTable.estimatedDurationDays,
        status: hotlistJobsTable.status,
        createdAt: hotlistJobsTable.createdAt,
        partnerName: partnersTable.name,
        partnerLogoUrl: partnersTable.logoUrl,
        // Task #51 — unread comment badge for vendor-facing rows.
        // Same shape as the partner branch above so the dashboard
        // hotlist section can render the badge regardless of role.
        unreadCommentCount: unreadHotlistCommentCountSql(
          sql`${hotlistJobsTable.id}`,
          session.userId,
        ),
      })
      .from(hotlistJobsTable)
      .leftJoin(partnersTable, eq(hotlistJobsTable.partnerId, partnersTable.id))
      .where(and(eq(hotlistJobsTable.status, "open"), isNull(hotlistJobsTable.deletedAt)))
      .orderBy(desc(hotlistJobsTable.createdAt));

    // Include ALL open geocoded jobs, marking those outside the operating radius.
    // The UI shows in-radius jobs prominently and out-of-radius jobs in a collapsed/disabled state.
    const annotated: any[] = [];
    for (const j of openJobs) {
      if (j.latitude == null || j.longitude == null) continue;
      const d = distanceMiles(vendor.latitude, vendor.longitude, j.latitude, j.longitude);
      annotated.push({
        ...j,
        distanceMiles: Math.round(d * 10) / 10,
        outOfRadius: d > vendor.operatingRadiusMiles,
      });
    }
    annotated.sort((a, b) => a.distanceMiles - b.distanceMiles);

    // Task #727 — vendor-catalog-as-source-of-truth: jobs whose title /
    // description don't match any work type the vendor has on their
    // catalog are flagged outsideCatalog. Vendors with an *empty*
    // catalog see everything (signal: they haven't set one up yet).
    // `?includeAll=1` returns the full list; otherwise we filter it
    // down and surface the hidden count so the UI can prompt them.
    const catalogRows = await db
      .select({ name: workTypesTable.name, category: workTypesTable.category })
      .from(vendorWorkTypesTable)
      .innerJoin(
        workTypesTable,
        eq(vendorWorkTypesTable.workTypeId, workTypesTable.id),
      )
      .where(eq(vendorWorkTypesTable.vendorId, session.vendorId));
    const catalogTerms = new Set<string>();
    for (const r of catalogRows) {
      if (r.name) catalogTerms.add(r.name.trim().toLowerCase());
      if (r.category) catalogTerms.add(r.category.trim().toLowerCase());
    }
    const matchesCatalog = (j: { title: string; description: string | null }) => {
      if (catalogTerms.size === 0) return true;
      const hay = `${j.title} ${j.description ?? ""}`.toLowerCase();
      for (const term of catalogTerms) {
        if (term.length >= 3 && hay.includes(term)) return true;
      }
      return false;
    };
    const includeAll =
      req.query.includeAll === "1" || req.query.includeAll === "true";
    let catalogFilteredCount = 0;
    for (const j of annotated) {
      const inCat = matchesCatalog(j);
      j.outsideCatalog = !inCat;
      if (!inCat) catalogFilteredCount += 1;
    }
    const visible = includeAll
      ? annotated
      : annotated.filter((j) => !j.outsideCatalog);

    // also fetch this vendor's own bids to know which jobs they've already bid on
    const myBids = visible.length
      ? await db.select().from(hotlistBidsTable).where(and(eq(hotlistBidsTable.vendorId, session.vendorId), sql`${hotlistBidsTable.jobId} IN (${sql.join(visible.map((j) => sql`${j.id}`), sql`, `)})`))
      : [];
    const bidMap: Record<number, any> = {};
    for (const b of myBids) bidMap[b.jobId] = b;

    // Task #495 — surface this vendor's tier with each job's posting partner
    // so the UI can hide the Bid CTA for non-approved vendors. Tier is
    // computed per partnerId, not per job, so we cache the lookup.
    const tierCache = new Map<number, string>();
    for (const j of visible) {
      if (!tierCache.has(j.partnerId)) {
        tierCache.set(j.partnerId, await getVendorTier(session.vendorId, j.partnerId));
      }
    }
    return res.json({
      jobs: visible.map((j) => ({
        ...j,
        myBid: bidMap[j.id] ?? null,
        myTier: tierCache.get(j.partnerId) ?? "pre_onboarded",
      })),
      vendor: {
        latitude: vendor.latitude,
        longitude: vendor.longitude,
        operatingRadiusMiles: vendor.operatingRadiusMiles,
      },
      catalog: {
        size: catalogTerms.size,
        filteredCount: catalogFilteredCount,
        includeAll,
      },
    });
  }

  // admin
  if (session.role === "admin") {
    const includeDeleted = req.query.includeDeleted === "true";
    const baseQuery = db
      .select({
        id: hotlistJobsTable.id,
        partnerId: hotlistJobsTable.partnerId,
        title: hotlistJobsTable.title,
        description: hotlistJobsTable.description,
        locationAddress: hotlistJobsTable.locationAddress,
        latitude: hotlistJobsTable.latitude,
        longitude: hotlistJobsTable.longitude,
        deadline: hotlistJobsTable.deadline,
        estimatedDurationDays: hotlistJobsTable.estimatedDurationDays,
        status: hotlistJobsTable.status,
        awardedVendorId: hotlistJobsTable.awardedVendorId,
        convertedTicketId: hotlistJobsTable.convertedTicketId,
        createdAt: hotlistJobsTable.createdAt,
        deletedAt: hotlistJobsTable.deletedAt,
        partnerName: partnersTable.name,
        partnerLogoUrl: partnersTable.logoUrl,
        // Task #51 — unread comment badge for the admin-facing
        // hotlist row. Mirrors the partner / vendor branches above.
        unreadCommentCount: unreadHotlistCommentCountSql(
          sql`${hotlistJobsTable.id}`,
          session.userId,
        ),
      })
      .from(hotlistJobsTable)
      .leftJoin(partnersTable, eq(hotlistJobsTable.partnerId, partnersTable.id));
    const rows = includeDeleted
      ? await baseQuery.orderBy(desc(hotlistJobsTable.createdAt))
      : await baseQuery
          .where(isNull(hotlistJobsTable.deletedAt))
          .orderBy(desc(hotlistJobsTable.createdAt));
    return res.json(rows);
  }

  return res.json([]);
});

// Create job (partner posts for themselves; admin may post on behalf of any partner via body.partnerId)
router.post("/hotlist/jobs", async (req, res) => {
  const session = getSession(req);
  if (!session) return sendApiError(res, 401, "auth.not_authenticated", "Unauthorized");

  const { title, description, locationAddress, deadline, estimatedDurationDays, partnerId: bodyPartnerId } = req.body ?? {};
  if (!title || !locationAddress) return sendApiError(res, 400, "hotlist.title_required", "title and locationAddress are required");

  let partnerId: number;
  if (session.role === "admin") {
    const pid = Number(bodyPartnerId);
    if (!Number.isFinite(pid) || pid <= 0) {
      return sendApiError(res, 400, "hotlist.partner_id_required", "Admin must specify partnerId when posting a Hotlist job");
    }
    const [partner] = await db.select({ id: partnersTable.id }).from(partnersTable).where(eq(partnersTable.id, pid));
    if (!partner) return sendApiError(res, 404, "partner.not_found", "Partner not found");
    partnerId = pid;
  } else if (session.role === "partner" && session.partnerId) {
    partnerId = session.partnerId;
  } else {
    return sendApiError(res, 403, "hotlist.partner_only_post", "Only partners or admins may post Hotlist jobs");
  }

  const geo = await geocode(locationAddress);
  const [row] = await db
    .insert(hotlistJobsTable)
    .values({
      partnerId,
      title,
      description: description || null,
      locationAddress,
      latitude: geo?.lat ?? null,
      longitude: geo?.lng ?? null,
      deadline: deadline || null,
      estimatedDurationDays: estimatedDurationDays != null ? Number(estimatedDurationDays) : null,
      status: "open",
    })
    .returning();
  return res.status(201).json(row);
});

// Job detail with bids (partner owner / admin)
router.get("/hotlist/jobs/:id", async (req, res) => {
  const session = getSession(req);
  if (!session) return sendApiError(res, 401, "auth.not_authenticated", "Unauthorized");
  // Same per-session budget as the list endpoint above; bidders
  // refreshing the detail view share the bucket so a single tab
  // can't sit on a tight loop and overwhelm the joined query.
  if (!await enforceHotlistRateLimit(req, res, session)) return;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return sendApiError(res, 400, "validation.invalid_id", "Invalid id");
  const [job] = await db.select().from(hotlistJobsTable).where(eq(hotlistJobsTable.id, id));
  if (!job) return sendApiError(res, 404, "hotlist.not_found", "Not found");
  const isOwner = session.role === "partner" && session.partnerId === job.partnerId;
  if (!isOwner && session.role !== "admin") return sendApiError(res, 403, "auth.forbidden", "Forbidden");
  // Soft-deleted jobs are only visible to admin (so they can restore them).
  if (job.deletedAt && session.role !== "admin") return sendApiError(res, 404, "hotlist.not_found", "Not found");
  // Tag each bid with the (job.partner ↔ vendor) relationship status so
  // the partner UI can hide unaffiliated bids by default and only show
  // them when there are no preferred/approved bids on the job. The left
  // join over partner_vendor_relationships is filtered by job.partnerId
  // so a vendor "approved" by a different partner still shows as
  // unaffiliated for THIS job's partner.
  const bids = await db
    .select({
      id: hotlistBidsTable.id,
      jobId: hotlistBidsTable.jobId,
      vendorId: hotlistBidsTable.vendorId,
      amountUsd: hotlistBidsTable.amountUsd,
      etaDays: hotlistBidsTable.etaDays,
      notes: hotlistBidsTable.notes,
      status: hotlistBidsTable.status,
      createdAt: hotlistBidsTable.createdAt,
      vendorName: vendorsTable.name,
      // Vendor fields needed to compute the same gating annotations
      // surfaced on the Direct Award candidate dropdown (Task #502):
      // distance to the job's location, in-radius status, and the
      // compliance floor (COI, insurance expiration, federal tax id).
      // Pulled here so the partner UI can grey out and explain
      // ineligible bidders before the partner clicks Award.
      vendorLatitude: vendorsTable.latitude,
      vendorLongitude: vendorsTable.longitude,
      vendorOperatingRadiusMiles: vendorsTable.operatingRadiusMiles,
      vendorCoiDocumentUrl: vendorsTable.coiDocumentUrl,
      vendorInsuranceExpirationDate: vendorsTable.insuranceExpirationDate,
      vendorFederalTaxId: vendorsTable.federalTaxId,
      relationshipStatus: partnerVendorRelationshipsTable.status,
    })
    .from(hotlistBidsTable)
    .leftJoin(vendorsTable, eq(hotlistBidsTable.vendorId, vendorsTable.id))
    .leftJoin(
      partnerVendorRelationshipsTable,
      and(
        eq(partnerVendorRelationshipsTable.vendorId, hotlistBidsTable.vendorId),
        eq(partnerVendorRelationshipsTable.partnerId, job.partnerId),
      ),
    )
    .where(eq(hotlistBidsTable.jobId, id))
    .orderBy(desc(hotlistBidsTable.createdAt));

  // Task #847 — Mirror the Direct Award candidate annotation contract
  // (Task #502) on the bid list so partners can spot bidders who would
  // be rejected at award time. The reason precedence matches the
  // submit-side checks: missing vendor service area → job not geocoded
  // → out-of-radius → compliance floor (COI / insurance / tax id).
  // The annotation is read-only; we still return the bid so the
  // partner can chase the vendor for re-approval out-of-band.
  type IneligibleReason =
    | "vendor_no_operating_area"
    | "job_not_geocoded"
    | "vendor_out_of_radius"
    | "missing_coi_document"
    | "missing_insurance_expiration"
    | "expired_insurance"
    | "missing_federal_tax_id";
  const today = new Date();
  const annotatedBids = bids.map((b) => {
    const floor = checkComplianceFloor(
      {
        coiDocumentUrl: b.vendorCoiDocumentUrl,
        insuranceExpirationDate: b.vendorInsuranceExpirationDate,
        federalTaxId: b.vendorFederalTaxId,
      },
      today,
    );
    const compliancePassed = floor.eligible;

    let distanceMilesValue: number | null = null;
    let inRadius = false;
    let radiusReason: IneligibleReason | null = null;
    let radiusMessage: string | null = null;

    if (
      b.vendorLatitude == null ||
      b.vendorLongitude == null ||
      b.vendorOperatingRadiusMiles == null
    ) {
      radiusReason = "vendor_no_operating_area";
      radiusMessage = "Vendor has not published an operating area";
    } else if (job.latitude == null || job.longitude == null) {
      radiusReason = "job_not_geocoded";
      radiusMessage =
        "Job location is not geocoded; vendor reachability cannot be verified";
    } else {
      const dist = distanceMiles(
        job.latitude,
        job.longitude,
        b.vendorLatitude,
        b.vendorLongitude,
      );
      distanceMilesValue = Math.round(dist * 10) / 10;
      if (dist > b.vendorOperatingRadiusMiles) {
        radiusReason = "vendor_out_of_radius";
        radiusMessage = `Vendor's operating radius (${b.vendorOperatingRadiusMiles} mi) does not cover this job (${distanceMilesValue} mi away)`;
      } else {
        inRadius = true;
      }
    }

    let ineligibleReason: IneligibleReason | null = null;
    let ineligibleMessage: string | null = null;
    if (radiusReason) {
      ineligibleReason = radiusReason;
      ineligibleMessage = radiusMessage;
    } else if (!compliancePassed) {
      ineligibleReason = floor.reason as IneligibleReason;
      ineligibleMessage = floor.message;
    }

    // Strip the bare vendor lookup columns from the row we return —
    // they were only joined to compute the annotation and aren't part
    // of the bid contract. Distance, radius, and the eligibility
    // verdict take their place.
    const {
      vendorLatitude: _vlat,
      vendorLongitude: _vlng,
      vendorOperatingRadiusMiles,
      vendorCoiDocumentUrl: _coi,
      vendorInsuranceExpirationDate: _insExp,
      vendorFederalTaxId: _ein,
      ...rest
    } = b;
    return {
      ...rest,
      distanceMiles: distanceMilesValue,
      operatingRadiusMiles: vendorOperatingRadiusMiles,
      inRadius,
      compliancePassed,
      eligible: inRadius && compliancePassed,
      ineligibleReason,
      ineligibleMessage,
    };
  });

  // Filter unaffiliated bids by default. Bids whose vendor has a
  // preferred|approved relationship with the job's partner are always
  // shown; everyone else is hidden until the partner explicitly opts
  // in via ?includeUnaffiliated=1. We always return the full count of
  // hidden bids so the UI can show "Show 3 unaffiliated bids".
  const includeUnaffiliated =
    req.query.includeUnaffiliated === "1" ||
    req.query.includeUnaffiliated === "true";
  const visibleBids = includeUnaffiliated
    ? annotatedBids
    : annotatedBids.filter(
        (b) =>
          b.relationshipStatus === "preferred" ||
          b.relationshipStatus === "approved",
      );
  const unaffiliatedCount = annotatedBids.length - visibleBids.length;

  return res.json({
    ...job,
    bids: visibleBids,
    unaffiliatedCount,
    totalBidCount: annotatedBids.length,
  });
});

// Place bid (vendor)
router.post("/hotlist/jobs/:id/bids", async (req, res) => {
  const session = getSession(req);
  if (!session || session.role !== "vendor" || !session.vendorId) {
    return sendApiError(res, 403, "hotlist.vendor_only_bid", "Only vendors may bid");
  }
  const id = parseInt(req.params.id);
  if (isNaN(id)) return sendApiError(res, 400, "validation.invalid_id", "Invalid id");
  const [job] = await db.select().from(hotlistJobsTable).where(eq(hotlistJobsTable.id, id));
  if (!job || job.deletedAt) return sendApiError(res, 404, "hotlist.job_not_found", "Job not found");
  if (job.status !== "open") return sendApiError(res, 400, "hotlist.job_closed", "Job is no longer open");

  // Enforce operating-radius eligibility: vendor must be geocoded with a radius
  // and the job location must be within that radius.
  const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, session.vendorId));
  if (!vendor || vendor.latitude == null || vendor.longitude == null || vendor.operatingRadiusMiles == null) {
    return sendApiError(res, 403, "hotlist.no_operating_area", "Set your operating area before bidding");
  }
  if (job.latitude == null || job.longitude == null) {
    return sendApiError(res, 400, "hotlist.no_geo", "Job has no geocoded location");
  }
  const d = distanceMiles(vendor.latitude, vendor.longitude, job.latitude, job.longitude);
  if (d > vendor.operatingRadiusMiles) {
    return res.status(403).json({
      error: "hotlist_out_of_radius",
      message: `Job is outside your operating radius (${Math.round(d)} mi away, limit ${vendor.operatingRadiusMiles})`,
      code: "hotlist.out_of_radius",
      details: { distance: Math.round(d), limit: vendor.operatingRadiusMiles },
    });
  }

  // Task #495 — three-tier vendor model. Only Approved vendors (those with a
  // preferred|approved partner_vendor_relationships row with the posting
  // partner) may BID on hotlist jobs. Pre-onboarded and Unapproved vendors
  // can still LIST/VIEW the job (the list endpoint is unchanged) so they
  // can request approval out-of-band, but the bid CTA itself is gated.
  // Direct Award (POST /tickets/direct-award) is the partner-initiated
  // escape hatch for unapproved vendors.
  const tier = await getVendorTier(session.vendorId, job.partnerId);
  if (tier !== "approved") {
    return res.status(403).json({
      error: "vendor_not_approved",
      message:
        "Only approved vendors can bid on hotlist jobs. Reach out to the Partner to request approval.",
      code: "hotlist.vendor_not_approved",
      tier,
    });
  }

  const { amountUsd, etaDays, notes } = req.body ?? {};
  const amount = Number(amountUsd);
  if (!Number.isFinite(amount) || amount <= 0) return sendApiError(res, 400, "hotlist.amount_invalid", "amountUsd must be positive");

  // upsert: replace existing bid from this vendor on this job
  const [existing] = await db
    .select()
    .from(hotlistBidsTable)
    .where(and(eq(hotlistBidsTable.jobId, id), eq(hotlistBidsTable.vendorId, session.vendorId)));

  let result;
  let isUpdate = false;
  if (existing) {
    isUpdate = true;
    const [updated] = await db
      .update(hotlistBidsTable)
      .set({ amountUsd: amount.toFixed(2), etaDays: etaDays != null ? Number(etaDays) : null, notes: notes || null })
      .where(eq(hotlistBidsTable.id, existing.id))
      .returning();
    result = updated;
  } else {
    const [bid] = await db
      .insert(hotlistBidsTable)
      .values({
        jobId: id,
        vendorId: session.vendorId,
        amountUsd: amount.toFixed(2),
        etaDays: etaDays != null ? Number(etaDays) : null,
        notes: notes || null,
        status: "pending",
      })
      .returning();
    result = bid;
  }

  // Notify the partner that owns the job.
  try {
    const partnerUserIds = await findPartnerUserIds(job.partnerId);
    await notifyUsers(partnerUserIds, {
      type: isUpdate ? "bid_updated" : "bid_placed",
      title: isUpdate ? "Bid updated on your Hotlist job" : "New bid on your Hotlist job",
      body: `${vendor.name} ${isUpdate ? "updated their bid to" : "bid"} $${amount.toFixed(2)} on "${job.title}"`,
      link: `/?hotlistJob=${job.id}`,
    });
  } catch (e) {
    console.error("notify partner failed", e);
  }

  return res.status(isUpdate ? 200 : 201).json(result);
});

// Award bid (partner owner)
router.post("/hotlist/bids/:id/award", async (req, res) => {
  const session = getSession(req);
  if (!session || session.role !== "partner" || !session.partnerId) {
    return sendApiError(res, 403, "hotlist.partner_only_award", "Only the posting partner may award");
  }
  const id = parseInt(req.params.id);
  if (isNaN(id)) return sendApiError(res, 400, "validation.invalid_id", "Invalid id");
  const [bid] = await db.select().from(hotlistBidsTable).where(eq(hotlistBidsTable.id, id));
  if (!bid) return sendApiError(res, 404, "hotlist.bid_not_found", "Bid not found");
  const [job] = await db.select().from(hotlistJobsTable).where(eq(hotlistJobsTable.id, bid.jobId));
  if (!job || job.partnerId !== session.partnerId) return sendApiError(res, 403, "auth.forbidden", "Forbidden");
  if (job.deletedAt) return sendApiError(res, 400, "hotlist.job_removed", "Job has been removed");
  if (job.status !== "open") return sendApiError(res, 400, "hotlist.job_not_open", "Job is not open");

  await db.update(hotlistBidsTable).set({ status: "declined" }).where(and(eq(hotlistBidsTable.jobId, job.id), eq(hotlistBidsTable.status, "pending")));
  await db.update(hotlistBidsTable).set({ status: "awarded" }).where(eq(hotlistBidsTable.id, bid.id));
  const [updatedJob] = await db
    .update(hotlistJobsTable)
    .set({ status: "awarded", awardedBidId: bid.id, awardedVendorId: bid.vendorId })
    .where(eq(hotlistJobsTable.id, job.id))
    .returning();

  // Notify the awarded vendor and any vendors whose bids were declined.
  try {
    const allBids = await db
      .select({ vendorId: hotlistBidsTable.vendorId, status: hotlistBidsTable.status })
      .from(hotlistBidsTable)
      .where(eq(hotlistBidsTable.jobId, job.id));
    for (const b of allBids) {
      const userIds = await findVendorUserIds(b.vendorId);
      if (b.vendorId === bid.vendorId) {
        await notifyUsers(userIds, {
          type: "job_awarded",
          title: "You won a Hotlist job!",
          body: `Your bid on "${job.title}" was awarded.`,
          link: `/?hotlistJob=${job.id}`,
        });
      } else if (b.status === "declined") {
        await notifyUsers(userIds, {
          type: "bid_declined",
          title: "Hotlist bid not selected",
          body: `Your bid on "${job.title}" was not selected.`,
          link: `/?hotlistJob=${job.id}`,
        });
      }
    }
  } catch (e) {
    console.error("notify vendors failed", e);
  }

  return res.json(updatedJob);
});

// Convert an awarded hotlist job into a real ticket bound to the
// awarded vendor. The partner picks site_location_id and work_type_id
// from their catalog (the work type must be one the awarded vendor is
// already configured for via site_work_assignments). Idempotent: if the
// job already has convertedTicketId set we 409 with that id so the
// caller can navigate to the existing ticket.
router.post("/hotlist/jobs/:id/convert", async (req, res) => {
  const session = getSession(req);
  if (!session || session.role !== "partner" || !session.partnerId) {
    return res.status(403).json({
      error: "hotlist_partner_only_convert",
      message: "Only the posting partner may convert this job to a ticket",
      code: "hotlist.partner_only_convert",
    });
  }
  const id = parseInt(req.params.id);
  if (isNaN(id)) return sendApiError(res, 400, "validation.invalid_id", "Invalid id");
  const siteLocationId = Number(req.body?.siteLocationId);
  const workTypeId = Number(req.body?.workTypeId);
  if (!Number.isFinite(siteLocationId) || siteLocationId <= 0) {
    return sendApiError(res, 400, "hotlist.site_location_required", "siteLocationId is required");
  }
  if (!Number.isFinite(workTypeId) || workTypeId <= 0) {
    return sendApiError(res, 400, "hotlist.work_type_required", "workTypeId is required");
  }
  const scheduledDurationRaw = req.body?.scheduledDurationMinutes;
  let scheduledDurationMinutes: number | null = null;
  if (scheduledDurationRaw != null) {
    const n = Number(scheduledDurationRaw);
    if (!Number.isFinite(n) || n < 0) {
      return res.status(400).json({
        error: "hotlist_invalid_duration",
        message: "scheduledDurationMinutes must be a non-negative integer",
        code: "hotlist.invalid_duration",
      });
    }
    scheduledDurationMinutes = Math.round(n);
  }
  let scheduledStartAt: Date | null = null;
  if (req.body?.scheduledStartAt) {
    const d = new Date(req.body.scheduledStartAt);
    if (!Number.isFinite(d.getTime())) {
      return sendApiError(res, 400, "hotlist.invalid_start", "scheduledStartAt is invalid");
    }
    scheduledStartAt = d;
  }

  const [job] = await db
    .select()
    .from(hotlistJobsTable)
    .where(eq(hotlistJobsTable.id, id));
  if (!job || job.deletedAt) {
    return sendApiError(res, 404, "hotlist.job_not_found", "Hotlist job not found");
  }
  if (job.partnerId !== session.partnerId) {
    return res
      .status(403)
      .json({
        error: "hotlist_partner_only_convert",
        message: "Only the posting partner may convert this job",
        code: "hotlist.partner_only_convert",
      });
  }
  if (job.status !== "awarded" || job.awardedVendorId == null) {
    return res.status(409).json({
      error: "hotlist_job_not_awarded",
      message:
        "Only awarded hotlist jobs (with a winning bid) can be converted to tickets",
      code: "hotlist.job_not_awarded",
    });
  }
  if (job.convertedTicketId != null) {
    return res.status(409).json({
      error: "already_converted",
      message: "This hotlist job has already been converted to a ticket",
      code: "hotlist.already_converted",
      convertedTicketId: job.convertedTicketId,
    });
  }

  // Site must belong to the partner.
  const [site] = await db
    .select({ id: siteLocationsTable.id, partnerId: siteLocationsTable.partnerId })
    .from(siteLocationsTable)
    .where(eq(siteLocationsTable.id, siteLocationId));
  if (!site) return sendApiError(res, 404, "site.not_found", "Site not found");
  if (site.partnerId !== session.partnerId) {
    return res
      .status(403)
      .json({
        error: "site_partner_mismatch",
        message: "Site does not belong to your partner organization",
        code: "site_location.partner_mismatch",
      });
  }

  // Work type must exist.
  const [workType] = await db
    .select({ id: workTypesTable.id })
    .from(workTypesTable)
    .where(eq(workTypesTable.id, workTypeId));
  if (!workType) return sendApiError(res, 404, "work_type.not_found", "Work type not found");

  const vendorId = job.awardedVendorId;
  // Auto-create the site_work_assignment if missing — the partner is
  // explicitly choosing this vendor for this site/work-type via the
  // hotlist conversion, mirroring the direct-award bootstrap path.
  const result = await db.transaction(async (tx) => {
    // Re-check inside the tx with a row-level lock so two concurrent
    // converts cannot both observe convertedTicketId=null and race to
    // create duplicate tickets.
    const [reread] = await tx
      .select({
        id: hotlistJobsTable.id,
        status: hotlistJobsTable.status,
        convertedTicketId: hotlistJobsTable.convertedTicketId,
      })
      .from(hotlistJobsTable)
      .where(eq(hotlistJobsTable.id, id))
      .for("update");
    if (!reread || reread.status !== "awarded") {
      throw Object.assign(new Error("hotlist_job_state_changed"), { http: 409 });
    }
    if (reread.convertedTicketId != null) {
      throw Object.assign(new Error("already_converted"), {
        http: 409,
        convertedTicketId: reread.convertedTicketId,
      });
    }

    const [existing] = await tx
      .select({ id: siteWorkAssignmentsTable.id })
      .from(siteWorkAssignmentsTable)
      .where(
        and(
          eq(siteWorkAssignmentsTable.siteLocationId, siteLocationId),
          eq(siteWorkAssignmentsTable.vendorId, vendorId),
          eq(siteWorkAssignmentsTable.workTypeId, workTypeId),
        ),
      );
    if (!existing) {
      await tx.insert(siteWorkAssignmentsTable).values({
        siteLocationId,
        vendorId,
        workTypeId,
      });
    }

    const [ticket] = await tx
      .insert(ticketsTable)
      .values({
        siteLocationId,
        vendorId,
        workTypeId,
        status: "awaiting_acceptance",
        intakeChannel: "partner_hotlist",
        lifecycleState: "pending_arrival",
        createdById: session.userId,
        scheduledStartAt,
        scheduledDurationMinutes,
        description: `Converted from Hotlist job: ${job.title}`,
      })
      .returning();

    // Conditional update: only succeeds if this tx still owns the
    // unclaimed slot. If 0 rows updated, another tx beat us — bail and
    // let the outer catch surface the existing convertedTicketId.
    const claimed = await tx
      .update(hotlistJobsTable)
      .set({ convertedTicketId: ticket.id })
      .where(
        and(
          eq(hotlistJobsTable.id, id),
          isNull(hotlistJobsTable.convertedTicketId),
        ),
      )
      .returning({ id: hotlistJobsTable.id });
    if (claimed.length === 0) {
      const [winner] = await tx
        .select({ convertedTicketId: hotlistJobsTable.convertedTicketId })
        .from(hotlistJobsTable)
        .where(eq(hotlistJobsTable.id, id));
      throw Object.assign(new Error("already_converted"), {
        http: 409,
        convertedTicketId: winner?.convertedTicketId ?? null,
      });
    }

    return ticket;
  }).catch((err: any) => {
    if (err?.message === "hotlist_job_state_changed") {
      return { __raceLost: true } as const;
    }
    if (err?.message === "already_converted") {
      return { __already: true, convertedTicketId: err.convertedTicketId } as const;
    }
    throw err;
  });

  if ("__raceLost" in result && result.__raceLost) {
    return res.status(409).json({
      error: "hotlist_job_state_changed",
      message: "Hotlist job state changed; refresh and try again",
      code: "hotlist.job_state_changed",
    });
  }
  if ("__already" in result && result.__already) {
    return res.status(409).json({
      error: "already_converted",
      message: "This hotlist job has already been converted to a ticket",
      code: "hotlist.already_converted",
      convertedTicketId: result.convertedTicketId,
    });
  }

  const ticket = result as { id: number };

  // Notify the awarded vendor that the partner created the ticket.
  try {
    const vendorUserIds = await findVendorUserIds(vendorId);
    const trackingNumber = String(ticket.id).padStart(8, "0");
    await notifyUsers(vendorUserIds, {
      type: "ticket_direct_award",
      title: "Hotlist job is now a ticket",
      body: `Ticket #${trackingNumber} was created for "${job.title}". Accept or deny to proceed.`,
      link: `/tickets/${ticket.id}`,
    });
  } catch (e) {
    console.error("[hotlist] failed to notify vendor of conversion", e);
  }

  return res.status(201).json({
    ticketId: ticket.id,
    convertedTicketId: ticket.id,
  });
});

// Soft-delete a job (partner owner / admin). Sets deletedAt; recoverable by admin via /restore.
router.delete("/hotlist/jobs/:id", async (req, res) => {
  const session = getSession(req);
  if (!session) return sendApiError(res, 401, "auth.not_authenticated", "Unauthorized");
  const id = parseInt(req.params.id);
  if (isNaN(id)) return sendApiError(res, 400, "validation.invalid_id", "Invalid id");
  const [job] = await db.select().from(hotlistJobsTable).where(eq(hotlistJobsTable.id, id));
  if (!job) return sendApiError(res, 404, "hotlist.not_found", "Not found");
  const isOwner = session.role === "partner" && session.partnerId === job.partnerId;
  if (!isOwner && session.role !== "admin") return sendApiError(res, 403, "auth.forbidden", "Forbidden");
  if (job.deletedAt) return res.status(204).send();
  await db
    .update(hotlistJobsTable)
    .set({ deletedAt: new Date() })
    .where(eq(hotlistJobsTable.id, id));
  return res.status(204).send();
});

// Restore a soft-deleted job (admin only).
router.post("/hotlist/jobs/:id/restore", async (req, res) => {
  const session = getSession(req);
  if (!session) return sendApiError(res, 401, "auth.not_authenticated", "Unauthorized");
  if (session.role !== "admin") return sendApiError(res, 403, "hotlist.admin_only_restore", "Only admins may restore removed jobs");
  const id = parseInt(req.params.id);
  if (isNaN(id)) return sendApiError(res, 400, "validation.invalid_id", "Invalid id");
  const [job] = await db.select().from(hotlistJobsTable).where(eq(hotlistJobsTable.id, id));
  if (!job) return sendApiError(res, 404, "hotlist.not_found", "Not found");
  if (!job.deletedAt) return res.json(job);
  const [restored] = await db
    .update(hotlistJobsTable)
    .set({ deletedAt: null })
    .where(eq(hotlistJobsTable.id, id))
    .returning();
  return res.json(restored);
});

export default router;
