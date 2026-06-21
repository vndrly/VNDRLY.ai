import { Router, type IRouter } from "express";
import { randomBytes } from "crypto";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  safetyEventsTable,
  safetyEventAttachmentsTable,
  safetyEventHistoryTable,
  safetyResolutionNotesTable,
  safetyCorrectiveActionsTable,
  safetyTrainingModulesTable,
  safetyTrainingCompletionsTable,
  siteLocationsTable,
  siteLocationAdminAuditLogTable,
  ticketsTable,
  usersTable,
  vendorsTable,
  partnersTable,
} from "@workspace/db";
import { requireSession, getSessionFromRequest, type SessionPayload } from "../lib/session";
import { sendApiError } from "../lib/apiError";
import {
  findPartnerHseUserIds,
  findVendorHseUserIds,
  sessionCanCloseSafetyEvent,
  sessionCanReactivateSite,
  sessionHasPartnerHse,
} from "../lib/safety-hse";
import { computeSafetyMetrics, loadSiteOperationalStatus } from "../lib/safety-metrics";
import { notifyUsers } from "./notifications";
import { enforceSafetyRateLimit } from "../lib/safety-rate-limit";

const router: IRouter = Router();

function readSession(req: Parameters<typeof getSessionFromRequest>[0]): SessionPayload {
  return getSessionFromRequest(req)!;
}

function generateEventNumber(): string {
  return "SAFE-" + randomBytes(4).toString("hex").toUpperCase();
}

function openStatuses() {
  return ["submitted", "under_review", "resolved"] as const;
}

function scopeFilters(session: SessionPayload) {
  if (session.role === "admin") return [];
  if (session.role === "partner" && session.partnerId) {
    return [eq(safetyEventsTable.partnerId, session.partnerId)];
  }
  if (session.role === "vendor" && session.vendorId) {
    return [eq(safetyEventsTable.vendorId, session.vendorId)];
  }
  if (session.role === "field_employee" && session.userId) {
    return [eq(safetyEventsTable.reportedByUserId, session.userId)];
  }
  return null;
}

function canViewReporter(session: SessionPayload): boolean {
  return session.role === "admin";
}

function redactEventForSession(
  session: SessionPayload,
  row: Record<string, unknown>,
): Record<string, unknown> {
  if (row.isAnonymous && !canViewReporter(session)) {
    const copy = { ...row };
    delete copy.reportedByUserId;
    delete copy.reporterName;
    copy.reporterLabel = "Anonymous field report";
    return copy;
  }
  return row;
}

async function appendHistory(opts: {
  eventId: number;
  fromStatus?: string | null;
  toStatus?: string | null;
  changeType: string;
  actorUserId?: number | null;
  actorRole?: string | null;
  detail?: string | null;
}) {
  await db.insert(safetyEventHistoryTable).values({
    eventId: opts.eventId,
    fromStatus: opts.fromStatus ?? null,
    toStatus: opts.toStatus ?? null,
    changeType: opts.changeType,
    actorUserId: opts.actorUserId ?? null,
    actorRole: opts.actorRole ?? null,
    detail: opts.detail ?? null,
  });
}

async function notifySafetyEvent(opts: {
  type: string;
  title: string;
  body: string;
  linkUrl: string;
  userIds: number[];
  dedupeKey: string;
}) {
  if (opts.userIds.length === 0) return;
  await notifyUsers(opts.userIds, {
    type: opts.type,
    title: opts.title,
    body: opts.body,
    link: opts.linkUrl,
    dedupeKey: opts.dedupeKey,
    category: "compliance",
  });
}

router.get("/safety/metrics", requireSession, async (req, res): Promise<void> => {
  const session = readSession(req);
  const siteId = req.query.siteId ? Number(req.query.siteId) : undefined;
  const metrics = await computeSafetyMetrics({
    partnerId: session.role === "partner" ? session.partnerId ?? undefined : undefined,
    vendorId: session.role === "vendor" ? session.vendorId ?? undefined : undefined,
    siteLocationId: Number.isFinite(siteId) ? siteId : undefined,
  });
  res.json({ success: true, data: metrics });
});

router.get("/safety/capabilities", requireSession, async (req, res): Promise<void> => {
  const session = readSession(req);
  const isPartnerHse = await sessionHasPartnerHse(session);
  res.json({ success: true, data: { isPartnerHse } });
});

router.get("/safety/training/status", requireSession, async (req, res): Promise<void> => {
  const session = readSession(req);
  if (!session.userId) {
    sendApiError(res, 401, "auth.unauthorized", "Sign in required.");
    return;
  }
  const roleKey =
    session.role === "field_employee"
      ? "field_employee"
      : session.role === "partner"
        ? "partner_office"
        : session.role === "vendor"
          ? "vendor_office"
          : "admin";

  const modules = await db
    .select()
    .from(safetyTrainingModulesTable)
    .where(eq(safetyTrainingModulesTable.isActive, true));

  const completions = await db
    .select()
    .from(safetyTrainingCompletionsTable)
    .where(eq(safetyTrainingCompletionsTable.userId, session.userId));

  const completedIds = new Set(completions.map((c) => c.moduleId));
  const required = modules.filter((m) =>
    m.requiredRoles.length === 0 ? false : m.requiredRoles.includes(roleKey),
  );
  const incomplete = required.filter((m) => !completedIds.has(m.id));

  res.json({
    success: true,
    data: {
      incompleteModules: incomplete,
      allComplete: incomplete.length === 0,
    },
  });
});

router.post("/safety/training/:moduleId/complete", requireSession, async (req, res): Promise<void> => {
  const session = readSession(req);
  if (!session.userId) {
    sendApiError(res, 401, "auth.unauthorized", "Sign in required.");
    return;
  }
  const moduleId = Number(req.params.moduleId);
  if (!Number.isFinite(moduleId)) {
    sendApiError(res, 400, "safety.invalid_module", "Invalid module id.");
    return;
  }
  const progress = Number(req.body?.watchProgressPct ?? 100);
  await db.insert(safetyTrainingCompletionsTable).values({
    userId: session.userId,
    moduleId,
    watchProgressPct: Math.min(100, Math.max(0, Math.floor(progress))),
  });
  res.json({ success: true });
});

router.get("/safety/events", requireSession, async (req, res): Promise<void> => {
  const session = readSession(req);
  const scope = scopeFilters(session);
  if (scope === null) {
    sendApiError(res, 403, "safety.forbidden", "No org scope on this session.");
    return;
  }

  const sinceDays = Math.min(365, Math.max(1, Number(req.query.sinceDays ?? 90) || 90));
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - sinceDays);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 25) || 25));
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const siteId = req.query.siteId ? Number(req.query.siteId) : undefined;
  const vendorId = req.query.vendorId ? Number(req.query.vendorId) : undefined;
  const eventType = typeof req.query.eventType === "string" ? req.query.eventType : undefined;
  const countOnly = req.query.countOnly === "true";

  const filters = [...scope, gte(safetyEventsTable.createdAt, since)];
  if (status) filters.push(eq(safetyEventsTable.status, status));
  if (Number.isFinite(siteId)) filters.push(eq(safetyEventsTable.siteLocationId, siteId!));
  if (Number.isFinite(vendorId)) filters.push(eq(safetyEventsTable.vendorId, vendorId!));
  if (eventType) filters.push(eq(safetyEventsTable.eventType, eventType));
  if (req.query.openOnly === "true") {
    filters.push(inArray(safetyEventsTable.status, [...openStatuses()]));
  }

  if (countOnly) {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(safetyEventsTable)
      .where(and(...filters));
    res.json({ success: true, data: { count: row?.count ?? 0 } });
    return;
  }

  const rows = await db
    .select({
      id: safetyEventsTable.id,
      eventNumber: safetyEventsTable.eventNumber,
      eventType: safetyEventsTable.eventType,
      status: safetyEventsTable.status,
      title: safetyEventsTable.title,
      siteLocationId: safetyEventsTable.siteLocationId,
      partnerId: safetyEventsTable.partnerId,
      vendorId: safetyEventsTable.vendorId,
      ticketId: safetyEventsTable.ticketId,
      isAnonymous: safetyEventsTable.isAnonymous,
      isHighPotential: safetyEventsTable.isHighPotential,
      isRecordable: safetyEventsTable.isRecordable,
      isStopWork: safetyEventsTable.isStopWork,
      reportedByUserId: safetyEventsTable.reportedByUserId,
      createdAt: safetyEventsTable.createdAt,
      siteName: siteLocationsTable.name,
      vendorName: vendorsTable.name,
    })
    .from(safetyEventsTable)
    .innerJoin(siteLocationsTable, eq(safetyEventsTable.siteLocationId, siteLocationsTable.id))
    .leftJoin(vendorsTable, eq(safetyEventsTable.vendorId, vendorsTable.id))
    .where(and(...filters))
    .orderBy(desc(safetyEventsTable.createdAt))
    .limit(limit);

  res.json({
    success: true,
    data: rows.map((r) => redactEventForSession(session, r)),
  });
});

router.get("/safety/events/:id", requireSession, async (req, res): Promise<void> => {
  const session = readSession(req);
  const eventId = Number(req.params.id);
  const scope = scopeFilters(session);
  if (scope === null || !Number.isFinite(eventId)) {
    sendApiError(res, 403, "safety.forbidden", "Not allowed.");
    return;
  }

  const [event] = await db
    .select({
      id: safetyEventsTable.id,
      eventNumber: safetyEventsTable.eventNumber,
      eventType: safetyEventsTable.eventType,
      status: safetyEventsTable.status,
      title: safetyEventsTable.title,
      description: safetyEventsTable.description,
      siteLocationId: safetyEventsTable.siteLocationId,
      partnerId: safetyEventsTable.partnerId,
      vendorId: safetyEventsTable.vendorId,
      ticketId: safetyEventsTable.ticketId,
      isAnonymous: safetyEventsTable.isAnonymous,
      isHighPotential: safetyEventsTable.isHighPotential,
      isRecordable: safetyEventsTable.isRecordable,
      isStopWork: safetyEventsTable.isStopWork,
      reportedByUserId: safetyEventsTable.reportedByUserId,
      createdAt: safetyEventsTable.createdAt,
      updatedAt: safetyEventsTable.updatedAt,
      closedAt: safetyEventsTable.closedAt,
      siteName: siteLocationsTable.name,
      siteStatus: siteLocationsTable.status,
      siteIsActive: siteLocationsTable.isActive,
      vendorName: vendorsTable.name,
      partnerName: partnersTable.name,
    })
    .from(safetyEventsTable)
    .innerJoin(siteLocationsTable, eq(safetyEventsTable.siteLocationId, siteLocationsTable.id))
    .innerJoin(partnersTable, eq(safetyEventsTable.partnerId, partnersTable.id))
    .leftJoin(vendorsTable, eq(safetyEventsTable.vendorId, vendorsTable.id))
    .where(and(eq(safetyEventsTable.id, eventId), ...scope))
    .limit(1);

  if (!event) {
    sendApiError(res, 404, "safety.not_found", "Safety event not found.");
    return;
  }

  const notes = await db
    .select()
    .from(safetyResolutionNotesTable)
    .where(eq(safetyResolutionNotesTable.eventId, eventId))
    .orderBy(desc(safetyResolutionNotesTable.createdAt));

  const history = await db
    .select()
    .from(safetyEventHistoryTable)
    .where(eq(safetyEventHistoryTable.eventId, eventId))
    .orderBy(desc(safetyEventHistoryTable.createdAt));

  const attachments = await db
    .select()
    .from(safetyEventAttachmentsTable)
    .where(eq(safetyEventAttachmentsTable.eventId, eventId));

  const capas = await db
    .select()
    .from(safetyCorrectiveActionsTable)
    .where(eq(safetyCorrectiveActionsTable.eventId, eventId))
    .orderBy(desc(safetyCorrectiveActionsTable.createdAt));

  res.json({
    success: true,
    data: {
      event: redactEventForSession(session, event),
      notes,
      history,
      attachments,
      correctiveActions: capas,
    },
  });
});

router.post("/safety/events", requireSession, enforceSafetyRateLimit, async (req, res): Promise<void> => {
  const session = readSession(req);
  if (!session.userId) {
    sendApiError(res, 401, "auth.unauthorized", "Sign in required.");
    return;
  }

  const {
    eventType,
    title,
    description,
    siteLocationId,
    vendorId,
    ticketId,
    isAnonymous,
    isStopWork,
    isHighPotential,
    latitude,
    longitude,
    attachmentPaths,
  } = req.body ?? {};

  if (!eventType || !title || !siteLocationId) {
    sendApiError(res, 400, "safety.invalid_payload", "eventType, title, and siteLocationId are required.");
    return;
  }

  const siteId = Number(siteLocationId);
  const [site] = await db
    .select({
      id: siteLocationsTable.id,
      partnerId: siteLocationsTable.partnerId,
      name: siteLocationsTable.name,
    })
    .from(siteLocationsTable)
    .where(eq(siteLocationsTable.id, siteId))
    .limit(1);
  if (!site) {
    sendApiError(res, 404, "safety.site_not_found", "Site not found.");
    return;
  }

  const resolvedVendorId =
    vendorId != null
      ? Number(vendorId)
      : session.vendorId ?? (ticketId ? await loadTicketVendorId(Number(ticketId)) : null);

  const now = new Date();
  const stopWork = Boolean(isStopWork);
  const eventNumber = generateEventNumber();

  const [created] = await db
    .insert(safetyEventsTable)
    .values({
      eventNumber,
      eventType: String(eventType),
      title: String(title).slice(0, 200),
      description: description ? String(description).slice(0, 4000) : null,
      siteLocationId: siteId,
      partnerId: site.partnerId,
      vendorId: resolvedVendorId ?? null,
      ticketId: ticketId ? Number(ticketId) : null,
      fieldEmployeeId: session.vendorPeopleId ?? null,
      reportedByUserId: session.userId,
      isAnonymous: Boolean(isAnonymous),
      isHighPotential: Boolean(isHighPotential),
      isStopWork: stopWork,
      siteDeactivatedAt: stopWork ? now : null,
      latitude: latitude != null ? Number(latitude) : null,
      longitude: longitude != null ? Number(longitude) : null,
    })
    .returning();

  await appendHistory({
    eventId: created.id,
    toStatus: "submitted",
    changeType: "created",
    actorUserId: session.userId,
    actorRole: session.role ?? null,
  });

  if (Array.isArray(attachmentPaths)) {
    for (const path of attachmentPaths.slice(0, 5)) {
      if (typeof path === "string" && path.trim()) {
        await db.insert(safetyEventAttachmentsTable).values({
          eventId: created.id,
          storagePath: path.trim(),
        });
      }
    }
  }

  if (stopWork) {
    await db
      .update(siteLocationsTable)
      .set({ isActive: false, status: "inactive" })
      .where(eq(siteLocationsTable.id, siteId));
    await db.insert(siteLocationAdminAuditLogTable).values({
      siteLocationId: siteId,
      action: "safety_stop_work",
      actorUserId: session.userId ?? null,
      actorRole: session.role ?? "unknown",
      changes: {
        status: { before: "active", after: "inactive" },
        isActive: { before: true, after: false },
        eventNumber,
      },
    });
  }

  const partnerHse = await findPartnerHseUserIds(site.partnerId);
  const vendorHse = resolvedVendorId ? await findVendorHseUserIds(resolvedVendorId) : [];
  const notifyIds = [...new Set([...partnerHse, ...vendorHse])];
  await notifySafetyEvent({
    type: stopWork ? "safety_stop_work" : "safety_event_submitted",
    title: stopWork ? `Stop-work at ${site.name}` : `Safety report: ${title}`,
    body: `${eventNumber} — ${String(eventType).replace(/_/g, " ")}`,
    linkUrl: `/safety/${created.id}`,
    userIds: notifyIds,
    dedupeKey: `safety_event_submitted:${created.id}`,
  });

  res.status(201).json({ success: true, data: redactEventForSession(session, created) });
});

async function loadTicketVendorId(ticketId: number): Promise<number | null> {
  const [row] = await db
    .select({ vendorId: ticketsTable.vendorId })
    .from(ticketsTable)
    .where(eq(ticketsTable.id, ticketId))
    .limit(1);
  return row?.vendorId ?? null;
}

router.patch("/safety/events/:id", requireSession, async (req, res): Promise<void> => {
  const session = readSession(req);
  const eventId = Number(req.params.id);
  const scope = scopeFilters(session);
  if (scope === null || !Number.isFinite(eventId)) {
    sendApiError(res, 403, "safety.forbidden", "Not allowed.");
    return;
  }

  const [existing] = await db
    .select()
    .from(safetyEventsTable)
    .where(and(eq(safetyEventsTable.id, eventId), ...scope))
    .limit(1);
  if (!existing) {
    sendApiError(res, 404, "safety.not_found", "Safety event not found.");
    return;
  }

  const isPartnerHse = await sessionHasPartnerHse(session);
  const isOffice = session.role === "partner" || session.role === "vendor" || session.role === "admin";
  if (!isOffice) {
    sendApiError(res, 403, "safety.forbidden", "Office role required to update events.");
    return;
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  const { status, isHighPotential, isRecordable, duplicateOfEventId, deniedReason } = req.body ?? {};

  if (status != null) {
    if (status === "denied" && !isPartnerHse && session.role !== "admin") {
      sendApiError(res, 403, "safety.forbidden", "Partner HSE required to deny events.");
      return;
    }
    patch.status = String(status);
  }
  if (isHighPotential != null) patch.isHighPotential = Boolean(isHighPotential);
  if (isRecordable != null && (isPartnerHse || session.role === "admin")) {
    patch.isRecordable = Boolean(isRecordable);
  }
  if (duplicateOfEventId != null) patch.duplicateOfEventId = Number(duplicateOfEventId);
  if (deniedReason != null) patch.deniedReason = String(deniedReason);

  const [updated] = await db
    .update(safetyEventsTable)
    .set(patch)
    .where(eq(safetyEventsTable.id, eventId))
    .returning();

  if (status != null && status !== existing.status) {
    await appendHistory({
      eventId,
      fromStatus: existing.status,
      toStatus: String(status),
      changeType: "status_change",
      actorUserId: session.userId ?? null,
      actorRole: session.role ?? null,
    });
  }

  res.json({ success: true, data: redactEventForSession(session, updated) });
});

router.post("/safety/events/:id/notes", requireSession, async (req, res): Promise<void> => {
  const session = readSession(req);
  const eventId = Number(req.params.id);
  const scope = scopeFilters(session);
  if (scope === null || !Number.isFinite(eventId) || !session.userId) {
    sendApiError(res, 403, "safety.forbidden", "Not allowed.");
    return;
  }

  const body = req.body?.body;
  if (!body || typeof body !== "string" || !body.trim()) {
    sendApiError(res, 400, "safety.invalid_note", "Note body is required.");
    return;
  }

  const [event] = await db
    .select({ id: safetyEventsTable.id })
    .from(safetyEventsTable)
    .where(and(eq(safetyEventsTable.id, eventId), ...scope))
    .limit(1);
  if (!event) {
    sendApiError(res, 404, "safety.not_found", "Safety event not found.");
    return;
  }

  const orgSide =
    session.role === "partner" ? "partner" : session.role === "vendor" ? "vendor" : "admin";

  const [note] = await db
    .insert(safetyResolutionNotesTable)
    .values({
      eventId,
      authorUserId: session.userId,
      authorRole: session.role ?? null,
      authorOrgSide: orgSide,
      body: body.trim().slice(0, 4000),
    })
    .returning();

  res.status(201).json({ success: true, data: note });
});

router.post("/safety/events/:id/close", requireSession, async (req, res): Promise<void> => {
  const session = readSession(req);
  const eventId = Number(req.params.id);
  if (!(await sessionCanCloseSafetyEvent(session))) {
    sendApiError(res, 403, "safety.close_forbidden", "Only Partner HSE may close safety events.");
    return;
  }

  const scope = scopeFilters(session);
  if (scope === null || !Number.isFinite(eventId)) {
    sendApiError(res, 403, "safety.forbidden", "Not allowed.");
    return;
  }

  const [event] = await db
    .select()
    .from(safetyEventsTable)
    .where(and(eq(safetyEventsTable.id, eventId), ...scope))
    .limit(1);
  if (!event) {
    sendApiError(res, 404, "safety.not_found", "Safety event not found.");
    return;
  }

  const notes = await db
    .select({ id: safetyResolutionNotesTable.id })
    .from(safetyResolutionNotesTable)
    .where(eq(safetyResolutionNotesTable.eventId, eventId))
    .limit(1);
  if (notes.length === 0) {
    sendApiError(res, 409, "safety.notes_required", "At least one resolution note is required before close.");
    return;
  }

  const openCapas = await db
    .select({ id: safetyCorrectiveActionsTable.id })
    .from(safetyCorrectiveActionsTable)
    .where(
      and(
        eq(safetyCorrectiveActionsTable.eventId, eventId),
        inArray(safetyCorrectiveActionsTable.status, ["open", "overdue"]),
      ),
    );
  if (openCapas.length > 0) {
    sendApiError(res, 409, "safety.capas_open", "Close or verify all corrective actions before closing the event.");
    return;
  }

  const now = new Date();
  const [updated] = await db
    .update(safetyEventsTable)
    .set({
      status: "closed",
      closedAt: now,
      closedByUserId: session.userId ?? null,
      updatedAt: now,
    })
    .where(eq(safetyEventsTable.id, eventId))
    .returning();

  await appendHistory({
    eventId,
    fromStatus: event.status,
    toStatus: "closed",
    changeType: "closed",
    actorUserId: session.userId ?? null,
    actorRole: session.role ?? null,
  });

  res.json({ success: true, data: redactEventForSession(session, updated) });
});

router.post("/safety/events/:id/corrective-actions", requireSession, async (req, res): Promise<void> => {
  const session = readSession(req);
  const eventId = Number(req.params.id);
  const scope = scopeFilters(session);
  if (scope === null || !Number.isFinite(eventId)) {
    sendApiError(res, 403, "safety.forbidden", "Not allowed.");
    return;
  }
  if (session.role !== "partner" && session.role !== "vendor" && session.role !== "admin") {
    sendApiError(res, 403, "safety.forbidden", "Office role required.");
    return;
  }

  const { title, description, assigneeUserId, dueDate } = req.body ?? {};
  if (!title) {
    sendApiError(res, 400, "safety.invalid_capa", "Title is required.");
    return;
  }

  const [event] = await db
    .select({ id: safetyEventsTable.id })
    .from(safetyEventsTable)
    .where(and(eq(safetyEventsTable.id, eventId), ...scope))
    .limit(1);
  if (!event) {
    sendApiError(res, 404, "safety.not_found", "Safety event not found.");
    return;
  }

  const [capa] = await db
    .insert(safetyCorrectiveActionsTable)
    .values({
      eventId,
      title: String(title).slice(0, 200),
      description: description ? String(description).slice(0, 2000) : null,
      assigneeUserId: assigneeUserId ? Number(assigneeUserId) : null,
      dueDate: dueDate ? new Date(dueDate) : null,
    })
    .returning();

  res.status(201).json({ success: true, data: capa });
});

router.patch("/safety/corrective-actions/:id", requireSession, async (req, res): Promise<void> => {
  const session = readSession(req);
  const capaId = Number(req.params.id);
  if (!Number.isFinite(capaId)) {
    sendApiError(res, 400, "safety.invalid_capa", "Invalid id.");
    return;
  }

  const [capa] = await db
    .select()
    .from(safetyCorrectiveActionsTable)
    .where(eq(safetyCorrectiveActionsTable.id, capaId))
    .limit(1);
  if (!capa) {
    sendApiError(res, 404, "safety.capa_not_found", "Corrective action not found.");
    return;
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  const { status, verificationPhotoPath } = req.body ?? {};
  if (status != null) patch.status = String(status);
  if (verificationPhotoPath != null) {
    patch.verificationPhotoPath = String(verificationPhotoPath);
    patch.verifiedAt = new Date();
    patch.verifiedByUserId = session.userId ?? null;
    patch.status = "verified";
  }

  const [updated] = await db
    .update(safetyCorrectiveActionsTable)
    .set(patch)
    .where(eq(safetyCorrectiveActionsTable.id, capaId))
    .returning();

  res.json({ success: true, data: updated });
});

router.patch("/site-locations/:id/status", requireSession, async (req, res): Promise<void> => {
  const session = readSession(req);
  const siteId = Number(req.params.id);
  const nextStatus = req.body?.status;
  if (!Number.isFinite(siteId) || !nextStatus) {
    sendApiError(res, 400, "safety.invalid_site_status", "site id and status required.");
    return;
  }

  const [site] = await db
    .select()
    .from(siteLocationsTable)
    .where(eq(siteLocationsTable.id, siteId))
    .limit(1);
  if (!site) {
    sendApiError(res, 404, "safety.site_not_found", "Site not found.");
    return;
  }

  if (session.role === "partner" && session.partnerId !== site.partnerId) {
    sendApiError(res, 403, "safety.forbidden", "Not your site.");
    return;
  }

  const activating = nextStatus === "active";
  if (activating && !(await sessionCanReactivateSite(session))) {
    sendApiError(res, 403, "safety.reactivate_forbidden", "Only Partner HSE may reactivate a site.");
    return;
  }

  const isActive = activating;
  await db
    .update(siteLocationsTable)
    .set({ status: activating ? "active" : "inactive", isActive })
    .where(eq(siteLocationsTable.id, siteId));

  await db.insert(siteLocationAdminAuditLogTable).values({
    siteLocationId: siteId,
    action: activating ? "safety_reactivate" : "manual_inactive",
    actorUserId: session.userId ?? null,
    actorRole: session.role ?? "unknown",
    changes: {
      status: { before: site.status, after: activating ? "active" : "inactive" },
      isActive: { before: site.isActive, after: isActive },
    },
  });

  if (activating && site.partnerId) {
    const vendorHse = await findVendorHseUserIds(site.partnerId);
    void vendorHse;
  }

  const statusPayload = await loadSiteOperationalStatus(siteId);
  res.json({ success: true, data: statusPayload });
});

export default router;
