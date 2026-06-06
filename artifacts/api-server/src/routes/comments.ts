import { Router, type IRouter, type Request, type Response } from "express";
import { aliasedTable, and, eq, desc, gte, isNotNull, sql } from "drizzle-orm";
import crypto from "crypto";
import {
  db,
  ticketsTable,
  siteLocationsTable,
  ticketNoteLogsTable,
  hotlistJobsTable,
  hotlistBidsTable,
  hotlistCommentsTable,
  commentReadReceiptsTable,
  usersTable,
  fieldEmployeesTable,
} from "@workspace/db";
import { notifyUsers, findVendorUserIds, findPartnerUserIds } from "./notifications";

import { SESSION_SECRET } from "../lib/session";
import {
  publishHotlistCommentEvent,
  subscribeHotlistCommentEvents,
  getCurrentHotlistCommentEventSeq,
  type PublishedHotlistCommentEvent,
} from "../lib/hotlist-comment-events";
import { enforceCommentsRateLimit } from "../lib/comments-rate-limit";
import { enforceParticipantsRateLimit } from "../lib/participants-rate-limit";
import { sendApiError } from "../lib/apiError";
import { withSerialInsertRetry } from "../lib/pg-sequence-resync";

const COOKIE_NAME = "vndrly_session";
const EDIT_WINDOW_MS = 5 * 60 * 1000;

type Session = { userId: number; role: string; vendorId: number | null; partnerId: number | null; displayName?: string };
type EditHistoryEntry = { at: string; prev: string };

function isSafeAttachmentUrl(a: string): boolean {
  return a.startsWith("/api/storage/") || a.startsWith("/objects/");
}

function parseEditHistory(raw: unknown): EditHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (entry && typeof entry === "object" && "at" in entry && "prev" in entry) {
      const at = (entry as { at: unknown }).at;
      const prev = (entry as { prev: unknown }).prev;
      if (typeof at === "string" && typeof prev === "string") return [{ at, prev }];
    }
    return [];
  });
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

// Parse "@displayname" tokens out of body. Names may contain spaces if quoted
// (e.g. @"Jane Doe"). For simplicity, we accept @word characters or quoted form.
function extractMentionTokens(text: string): string[] {
  const tokens = new Set<string>();
  const re = /@(?:"([^"]+)"|([A-Za-z0-9_.\-]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) tokens.add((m[1] ?? m[2] ?? "").trim());
  return [...tokens].filter(Boolean);
}

async function resolveMentionUserIds(tokens: string[], candidateUserIds: number[]): Promise<number[]> {
  if (!tokens.length || !candidateUserIds.length) return [];
  const rows = await db
    .select({ id: usersTable.id, displayName: usersTable.displayName, username: usersTable.username })
    .from(usersTable)
    .where(sql`${usersTable.id} IN (${sql.join(candidateUserIds.map((i) => sql`${i}`), sql`, `)})`);
  const lower = tokens.map((t) => t.toLowerCase());
  const matched = new Set<number>();
  for (const u of rows) {
    const dn = (u.displayName ?? "").toLowerCase();
    const un = (u.username ?? "").toLowerCase();
    if (lower.some((t) => t === dn || t === un)) matched.add(u.id);
  }
  return [...matched];
}

// ---------------- Ticket participants & authz ----------------

async function ticketParticipantUserIds(ticketId: number): Promise<{
  ids: number[];
  vendorId: number | null;
  partnerId: number | null;
  fieldUserId: number | null;
}> {
  const [t] = await db
    .select({
      vendorId: ticketsTable.vendorId,
      partnerId: siteLocationsTable.partnerId,
      fieldEmployeeId: ticketsTable.fieldEmployeeId,
      foremanUserId: ticketsTable.foremanUserId,
    })
    .from(ticketsTable)
    .leftJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
    .where(eq(ticketsTable.id, ticketId));
  if (!t) return { ids: [], vendorId: null, partnerId: null, fieldUserId: null };
  const ids = new Set<number>();
  if (t.vendorId) (await findVendorUserIds(t.vendorId)).forEach((i) => ids.add(i));
  if (t.partnerId) (await findPartnerUserIds(t.partnerId)).forEach((i) => ids.add(i));
  let fieldUserId: number | null = null;
  if (t.foremanUserId) ids.add(t.foremanUserId);
  if (t.fieldEmployeeId) {
    const [fe] = await db
      .select({ userId: fieldEmployeesTable.userId })
      .from(fieldEmployeesTable)
      .where(eq(fieldEmployeesTable.id, t.fieldEmployeeId));
    if (fe?.userId) {
      ids.add(fe.userId);
      fieldUserId = fe.userId;
    }
  }
  const { ticketParticipantUserIdsExpanded } = await import("../lib/field-ticket-access");
  const expanded = await ticketParticipantUserIdsExpanded(ticketId);
  expanded.ids.forEach((i) => ids.add(i));
  return { ids: [...ids], vendorId: t.vendorId, partnerId: t.partnerId, fieldUserId };
}

function canParticipateTicket(session: Session, ctx: { ids: number[]; vendorId: number | null; partnerId: number | null; fieldUserId: number | null }): boolean {
  if (session.role === "admin") return true;
  if (session.role === "vendor" && session.vendorId && session.vendorId === ctx.vendorId) return true;
  if (session.role === "partner" && session.partnerId && session.partnerId === ctx.partnerId) return true;
  if (session.role === "field_employee" && ctx.ids.includes(session.userId)) return true;
  return false;
}

// ---------------- Hotlist participants & authz ----------------

async function hotlistParticipantUserIds(jobId: number): Promise<{
  ids: number[];
  partnerId: number | null;
  bidderVendorIds: number[];
}> {
  const [job] = await db
    .select({ partnerId: hotlistJobsTable.partnerId })
    .from(hotlistJobsTable)
    .where(eq(hotlistJobsTable.id, jobId));
  if (!job) return { ids: [], partnerId: null, bidderVendorIds: [] };
  const ids = new Set<number>();
  (await findPartnerUserIds(job.partnerId)).forEach((i) => ids.add(i));
  const bidders = await db
    .selectDistinct({ vendorId: hotlistBidsTable.vendorId })
    .from(hotlistBidsTable)
    .where(eq(hotlistBidsTable.jobId, jobId));
  const bidderVendorIds = bidders.map((b) => b.vendorId);
  for (const v of bidderVendorIds) (await findVendorUserIds(v)).forEach((i) => ids.add(i));
  return { ids: [...ids], partnerId: job.partnerId, bidderVendorIds };
}

function canParticipateHotlist(session: Session, ctx: { partnerId: number | null; bidderVendorIds: number[] }): boolean {
  if (session.role === "admin") return true;
  if (session.role === "partner" && session.partnerId && session.partnerId === ctx.partnerId) return true;
  if (session.role === "vendor" && session.vendorId && ctx.bidderVendorIds.includes(session.vendorId)) return true;
  return false;
}

// ---------------- Read receipts ----------------

async function markAllSeen(source: "ticket" | "hotlist", commentIds: number[], userId: number) {
  if (!commentIds.length) return;
  const values = commentIds.map((id) => ({ source, commentId: id, userId }));
  await db.insert(commentReadReceiptsTable).values(values).onConflictDoNothing();
}

async function fetchReceipts(source: "ticket" | "hotlist", commentIds: number[]) {
  if (!commentIds.length) return new Map<number, { userId: number; seenAt: Date }[]>();
  const rows = await db
    .select()
    .from(commentReadReceiptsTable)
    .where(
      and(
        eq(commentReadReceiptsTable.source, source),
        sql`${commentReadReceiptsTable.commentId} IN (${sql.join(commentIds.map((i) => sql`${i}`), sql`, `)})`,
      ),
    );
  const map = new Map<number, { userId: number; seenAt: Date }[]>();
  for (const r of rows) {
    const arr = map.get(r.commentId) ?? [];
    arr.push({ userId: r.userId, seenAt: r.seenAt });
    map.set(r.commentId, arr);
  }
  return map;
}

// ============================================================
// TICKET COMMENTS
// ============================================================

const router: IRouter = Router();

router.get("/tickets/:id/comments", async (req: Request, res: Response): Promise<void> => {
  const session = getSession(req);
  if (!session) { sendApiError(res, 401, "auth.not_authenticated", "Unauthorized"); return; }
  const ticketId = parseInt(String(req.params.id));
  if (isNaN(ticketId)) { sendApiError(res, 400, "validation.invalid_id", "Invalid id"); return; }
  // Task #689: per-session, role-aware rate limit on the SSE-invalidated
  // comments thread. Applied BEFORE the participant check so an attacker
  // sweeping ticket ids also gets throttled rather than triggering the
  // joined participant lookup on every probe.
  if (!await enforceCommentsRateLimit(req, res, session)) return;

  const ctx = await ticketParticipantUserIds(ticketId);
  if (!canParticipateTicket(session, ctx)) {
    sendApiError(res, 403, "auth.forbidden", "Forbidden"); return;
  }

  // Task #52 — alias the users table a second time so we can left-join
  // both `created_by` and `deleted_by` in one round trip and return the
  // deleter's display name. Admins use this to power "View original" /
  // "Removed by … {{when}}" affordances; non-admins also get the field
  // (it's just metadata about the redaction, not the original content).
  const deletedByUsers = aliasedTable(usersTable, "deleted_by_user");
  const rows = await db
    .select({
      id: ticketNoteLogsTable.id,
      ticketId: ticketNoteLogsTable.ticketId,
      content: ticketNoteLogsTable.content,
      attachments: ticketNoteLogsTable.attachments,
      mentions: ticketNoteLogsTable.mentions,
      editHistory: ticketNoteLogsTable.editHistory,
      updatedAt: ticketNoteLogsTable.updatedAt,
      deletedAt: ticketNoteLogsTable.deletedAt,
      deletedById: ticketNoteLogsTable.deletedById,
      deletedByName: deletedByUsers.displayName,
      createdAt: ticketNoteLogsTable.createdAt,
      createdById: ticketNoteLogsTable.createdById,
      createdByName: usersTable.displayName,
      createdByRole: usersTable.role,
    })
    .from(ticketNoteLogsTable)
    .leftJoin(usersTable, eq(ticketNoteLogsTable.createdById, usersTable.id))
    .leftJoin(deletedByUsers, eq(ticketNoteLogsTable.deletedById, deletedByUsers.id))
    .where(eq(ticketNoteLogsTable.ticketId, ticketId))
    .orderBy(desc(ticketNoteLogsTable.createdAt));

  const ids = rows.map((r) => r.id);
  const receipts = await fetchReceipts("ticket", ids);
  // Mark unread-for-me as seen, and reflect that in the response.
  const nowSeen = new Date();
  const unreadForMe = ids.filter((id) => !(receipts.get(id) ?? []).some((r) => r.userId === session.userId));
  if (unreadForMe.length) {
    await markAllSeen("ticket", unreadForMe, session.userId);
    for (const id of unreadForMe) {
      const arr = receipts.get(id) ?? [];
      arr.push({ userId: session.userId, seenAt: nowSeen });
      receipts.set(id, arr);
    }
  }

  // Task #52 — admins keep getting the full row (content + attachments
  // + mentions + edit history) for deleted comments so the panel can
  // offer a "View original" toggle and let them restore the note. For
  // every other role we keep the existing redaction so a deleted note
  // stays deleted on their UI.
  const isAdmin = session.role === "admin";
  const enriched = rows.map((r) => {
    const seenBy = (receipts.get(r.id) ?? []).filter((u) => u.userId !== r.createdById);
    const isDeleted = !!r.deletedAt;
    const redact = isDeleted && !isAdmin;
    return {
      ...r,
      content: redact ? "[removed]" : r.content,
      attachments: redact ? null : r.attachments,
      mentions: redact ? null : r.mentions,
      editHistory: redact ? null : r.editHistory,
      seenBy,
      seenCount: seenBy.length,
    };
  });
  res.json(enriched);
});

router.get("/tickets/:id/comments/:commentId/seen-by", async (req: Request, res: Response): Promise<void> => {
  const session = getSession(req);
  if (!session) { sendApiError(res, 401, "auth.not_authenticated", "Unauthorized"); return; }
  const ticketId = parseInt(String(req.params.id));
  const commentId = parseInt(String(req.params.commentId));
  if (isNaN(ticketId) || isNaN(commentId)) { sendApiError(res, 400, "validation.invalid_id", "Invalid id"); return; }
  const ctx = await ticketParticipantUserIds(ticketId);
  if (!canParticipateTicket(session, ctx)) { sendApiError(res, 403, "auth.forbidden", "Forbidden"); return; }
  const [owning] = await db
    .select({ ticketId: ticketNoteLogsTable.ticketId })
    .from(ticketNoteLogsTable)
    .where(eq(ticketNoteLogsTable.id, commentId));
  if (!owning || owning.ticketId !== ticketId) { sendApiError(res, 404, "comment.not_found", "Not found"); return; }
  const rows = await db
    .select({ userId: commentReadReceiptsTable.userId, seenAt: commentReadReceiptsTable.seenAt, displayName: usersTable.displayName, role: usersTable.role })
    .from(commentReadReceiptsTable)
    .leftJoin(usersTable, eq(usersTable.id, commentReadReceiptsTable.userId))
    .where(and(eq(commentReadReceiptsTable.source, "ticket"), eq(commentReadReceiptsTable.commentId, commentId)));
  res.json(rows);
});

router.post("/tickets/:id/comments", async (req: Request, res: Response): Promise<void> => {
  try {
  const session = getSession(req);
  if (!session) { sendApiError(res, 401, "auth.not_authenticated", "Unauthorized"); return; }
  const ticketId = parseInt(String(req.params.id));
  if (isNaN(ticketId)) { sendApiError(res, 400, "validation.invalid_id", "Invalid id"); return; }
  const ctx = await ticketParticipantUserIds(ticketId);
  if (!canParticipateTicket(session, ctx)) { sendApiError(res, 403, "auth.forbidden", "Forbidden"); return; }

  const { content, attachments } = req.body ?? {};
  const text = String(content ?? "").trim();
  const atts = Array.isArray(attachments) ? attachments.filter((a) => typeof a === "string" && isSafeAttachmentUrl(a)) : [];
  if (!text && !atts.length) { sendApiError(res, 400, "comment.content_required", "content or attachments required"); return; }

  const tokens = extractMentionTokens(text);
  const mentionIds = await resolveMentionUserIds(tokens, ctx.ids);

  const [row] = await withSerialInsertRetry("ticket_note_logs", () =>
    db
      .insert(ticketNoteLogsTable)
      .values({
        ticketId,
        content: text || "[photo]",
        attachments: atts.length ? atts : null,
        mentions: mentionIds.length ? mentionIds : null,
        createdById: session.userId,
      })
      .returning(),
  );

  // Notify mentions explicitly + everyone else as new-comment / PTT
  const mentionSet = new Set(mentionIds);
  const others = ctx.ids.filter((u) => u !== session.userId && !mentionSet.has(u));
  const me = session.displayName || "Someone";
  const link = `/tickets/${ticketId}#comment-${row.id}`;
  const preview = text.slice(0, 120) || "[photo]";
  const isPtt =
    text.startsWith("[ptt") ||
    (atts.length > 0 && /audio|\.m4a|\.mp3|\.aac|\.wav/i.test(atts.join(" ")));

  if (mentionIds.length) {
    await notifyUsers(
      mentionIds.filter((u) => u !== session.userId),
      {
        type: "comment_mention",
        title: `${me} mentioned you`,
        body: preview,
        link,
        dedupeKey: `comment_mention:${row.id}`,
      },
    );
  }
  if (others.length) {
    await notifyUsers(others, {
      type: isPtt ? "ptt_message" : "comment_added",
      title: isPtt
        ? `${me} sent a voice message on #${String(ticketId).padStart(4, "0")}`
        : `${me} commented on tracking #${String(ticketId).padStart(4, "0")}`,
      body: isPtt ? "Tap to listen in Crew Comms" : preview,
      link,
      dedupeKey: isPtt ? `ptt_message:${row.id}` : `comment_added:${row.id}`,
      category: isPtt ? "crew" : undefined,
      pushData: isPtt ? { ticketId, commentId: row.id, type: "ptt_message" } : undefined,
    });
  }

  res.status(201).json(row);
  } catch (err) {
    req.log.error({ err, ticketId: req.params.id }, "POST /tickets/:id/comments failed");
    sendApiError(res, 500, "comment.create_failed", "Failed to post comment");
  }
});

router.patch("/tickets/:id/comments/:commentId", async (req: Request, res: Response): Promise<void> => {
  const session = getSession(req);
  if (!session) { sendApiError(res, 401, "auth.not_authenticated", "Unauthorized"); return; }
  const ticketId = parseInt(String(req.params.id));
  const commentId = parseInt(String(req.params.commentId));
  if (isNaN(ticketId) || isNaN(commentId)) { sendApiError(res, 400, "validation.invalid_id", "Invalid id"); return; }

  const ctx = await ticketParticipantUserIds(ticketId);
  if (!canParticipateTicket(session, ctx)) { sendApiError(res, 403, "auth.forbidden", "Forbidden"); return; }
  const [existing] = await db.select().from(ticketNoteLogsTable).where(eq(ticketNoteLogsTable.id, commentId));
  if (!existing || existing.ticketId !== ticketId) { sendApiError(res, 404, "comment.not_found", "Not found"); return; }
  if (existing.deletedAt) { sendApiError(res, 400, "comment.removed", "Comment removed"); return; }
  if (existing.createdById !== session.userId) { sendApiError(res, 403, "comment.not_editable", "Only the author can edit"); return; }

  const within = Date.now() - new Date(existing.createdAt).getTime() < EDIT_WINDOW_MS;
  const { content } = req.body ?? {};
  const newText = String(content ?? "").trim();
  if (!newText) { sendApiError(res, 400, "comment.content_required", "content required"); return; }

  if (within) {
    const history = parseEditHistory(existing.editHistory);
    history.push({ at: new Date().toISOString(), prev: existing.content });
    const [updated] = await db
      .update(ticketNoteLogsTable)
      .set({ content: newText, editHistory: history, updatedAt: new Date() })
      .where(eq(ticketNoteLogsTable.id, commentId))
      .returning();
    res.json(updated);
    return;
  }

  // Past edit window -> insert a new "quoted reply" rather than mutate
  const quotedBody = `> ${existing.content.replace(/\n/g, "\n> ")}\n\n${newText}`;
  const tokens = extractMentionTokens(newText);
  const mentionIds = await resolveMentionUserIds(tokens, ctx.ids);
  const [row] = await db
    .insert(ticketNoteLogsTable)
    .values({
      ticketId,
      content: quotedBody,
      mentions: mentionIds.length ? mentionIds : null,
      createdById: session.userId,
    })
    .returning();
  res.status(201).json(row);
});

router.delete("/tickets/:id/comments/:commentId", async (req: Request, res: Response): Promise<void> => {
  const session = getSession(req);
  if (!session) { sendApiError(res, 401, "auth.not_authenticated", "Unauthorized"); return; }
  const ticketId = parseInt(String(req.params.id));
  const commentId = parseInt(String(req.params.commentId));
  if (isNaN(ticketId) || isNaN(commentId)) { sendApiError(res, 400, "validation.invalid_id", "Invalid id"); return; }
  const ctx = await ticketParticipantUserIds(ticketId);
  if (!canParticipateTicket(session, ctx)) { sendApiError(res, 403, "auth.forbidden", "Forbidden"); return; }
  const [existing] = await db.select().from(ticketNoteLogsTable).where(eq(ticketNoteLogsTable.id, commentId));
  if (!existing || existing.ticketId !== ticketId) { sendApiError(res, 404, "comment.not_found", "Not found"); return; }
  const isAuthor = existing.createdById === session.userId;
  if (!isAuthor && session.role !== "admin") { sendApiError(res, 403, "comment.not_deletable", "Only the author or admin can remove"); return; }
  if (existing.deletedAt) { res.json({ ok: true }); return; }
  await db
    .update(ticketNoteLogsTable)
    .set({ deletedAt: new Date(), deletedById: session.userId })
    .where(eq(ticketNoteLogsTable.id, commentId));
  res.json({ ok: true });
});

// Task #52 — admin-only restore for a soft-deleted ticket comment.
// Mirrors the DELETE handler's authz shape (must be a participant of the
// underlying ticket and an admin) and clears `deleted_at` + `deleted_by_id`
// on the row so the comment is visible again to every participant.
router.post("/tickets/:id/comments/:commentId/restore", async (req: Request, res: Response): Promise<void> => {
  const session = getSession(req);
  if (!session) { sendApiError(res, 401, "auth.not_authenticated", "Unauthorized"); return; }
  if (session.role !== "admin") { sendApiError(res, 403, "auth.admin_required", "Admin role required"); return; }
  const ticketId = parseInt(String(req.params.id));
  const commentId = parseInt(String(req.params.commentId));
  if (isNaN(ticketId) || isNaN(commentId)) { sendApiError(res, 400, "validation.invalid_id", "Invalid id"); return; }
  const [existing] = await db.select().from(ticketNoteLogsTable).where(eq(ticketNoteLogsTable.id, commentId));
  if (!existing || existing.ticketId !== ticketId) { sendApiError(res, 404, "comment.not_found", "Not found"); return; }
  if (!existing.deletedAt) { res.json({ ok: true, restored: false }); return; }
  const [restored] = await db
    .update(ticketNoteLogsTable)
    .set({ deletedAt: null, deletedById: null })
    .where(eq(ticketNoteLogsTable.id, commentId))
    .returning();
  res.json({ ok: true, restored: true, comment: restored });
});

// ============================================================
// HOTLIST JOB COMMENTS
// ============================================================

router.get("/hotlist/jobs/:id/comments", async (req: Request, res: Response): Promise<void> => {
  const session = getSession(req);
  if (!session) { sendApiError(res, 401, "auth.not_authenticated", "Unauthorized"); return; }
  const jobId = parseInt(String(req.params.id));
  if (isNaN(jobId)) { sendApiError(res, 400, "validation.invalid_id", "Invalid id"); return; }
  // Task #689: same role-aware comments limiter as the ticket
  // thread above. The hotlist channel actively pushes per-comment
  // events ("created"/"updated"/"deleted") that each invalidate
  // the whole thread, so this is the limiter's hottest call site.
  if (!await enforceCommentsRateLimit(req, res, session)) return;
  const ctx = await hotlistParticipantUserIds(jobId);
  if (!canParticipateHotlist(session, ctx)) { sendApiError(res, 403, "auth.forbidden", "Forbidden"); return; }

  // Task #52 — see the matching alias on the ticket-comments GET above.
  // Same pattern (left-join the users table twice) so admins get the
  // deleter's display name + the original content for the "View
  // original" / "Restore" affordance.
  const deletedByUsers = aliasedTable(usersTable, "deleted_by_user");
  const rows = await db
    .select({
      id: hotlistCommentsTable.id,
      jobId: hotlistCommentsTable.jobId,
      content: hotlistCommentsTable.content,
      attachments: hotlistCommentsTable.attachments,
      mentions: hotlistCommentsTable.mentions,
      editHistory: hotlistCommentsTable.editHistory,
      updatedAt: hotlistCommentsTable.updatedAt,
      deletedAt: hotlistCommentsTable.deletedAt,
      deletedById: hotlistCommentsTable.deletedById,
      deletedByName: deletedByUsers.displayName,
      createdAt: hotlistCommentsTable.createdAt,
      createdById: hotlistCommentsTable.createdById,
      createdByName: usersTable.displayName,
      createdByRole: usersTable.role,
    })
    .from(hotlistCommentsTable)
    .leftJoin(usersTable, eq(hotlistCommentsTable.createdById, usersTable.id))
    .leftJoin(deletedByUsers, eq(hotlistCommentsTable.deletedById, deletedByUsers.id))
    .where(eq(hotlistCommentsTable.jobId, jobId))
    .orderBy(desc(hotlistCommentsTable.createdAt));

  const ids = rows.map((r) => r.id);
  const receipts = await fetchReceipts("hotlist", ids);
  const nowSeen = new Date();
  const unreadForMe = ids.filter((id) => !(receipts.get(id) ?? []).some((r) => r.userId === session.userId));
  if (unreadForMe.length) {
    await markAllSeen("hotlist", unreadForMe, session.userId);
    for (const id of unreadForMe) {
      const arr = receipts.get(id) ?? [];
      arr.push({ userId: session.userId, seenAt: nowSeen });
      receipts.set(id, arr);
    }
  }

  const isAdmin = session.role === "admin";
  const enriched = rows.map((r) => {
    const seenBy = (receipts.get(r.id) ?? []).filter((u) => u.userId !== r.createdById);
    const isDeleted = !!r.deletedAt;
    const redact = isDeleted && !isAdmin;
    return {
      ...r,
      content: redact ? "[removed]" : r.content,
      attachments: redact ? null : r.attachments,
      mentions: redact ? null : r.mentions,
      editHistory: redact ? null : r.editHistory,
      seenBy,
      seenCount: seenBy.length,
    };
  });
  res.json(enriched);
});

router.get("/hotlist/jobs/:id/comments/:commentId/seen-by", async (req: Request, res: Response): Promise<void> => {
  const session = getSession(req);
  if (!session) { sendApiError(res, 401, "auth.not_authenticated", "Unauthorized"); return; }
  const jobId = parseInt(String(req.params.id));
  const commentId = parseInt(String(req.params.commentId));
  if (isNaN(jobId) || isNaN(commentId)) { sendApiError(res, 400, "validation.invalid_id", "Invalid id"); return; }
  const ctx = await hotlistParticipantUserIds(jobId);
  if (!canParticipateHotlist(session, ctx)) { sendApiError(res, 403, "auth.forbidden", "Forbidden"); return; }
  const [owning] = await db
    .select({ jobId: hotlistCommentsTable.jobId })
    .from(hotlistCommentsTable)
    .where(eq(hotlistCommentsTable.id, commentId));
  if (!owning || owning.jobId !== jobId) { sendApiError(res, 404, "comment.not_found", "Not found"); return; }
  const rows = await db
    .select({ userId: commentReadReceiptsTable.userId, seenAt: commentReadReceiptsTable.seenAt, displayName: usersTable.displayName, role: usersTable.role })
    .from(commentReadReceiptsTable)
    .leftJoin(usersTable, eq(usersTable.id, commentReadReceiptsTable.userId))
    .where(and(eq(commentReadReceiptsTable.source, "hotlist"), eq(commentReadReceiptsTable.commentId, commentId)));
  res.json(rows);
});

router.post("/hotlist/jobs/:id/comments", async (req: Request, res: Response): Promise<void> => {
  try {
  const session = getSession(req);
  if (!session) { sendApiError(res, 401, "auth.not_authenticated", "Unauthorized"); return; }
  const jobId = parseInt(String(req.params.id));
  if (isNaN(jobId)) { sendApiError(res, 400, "validation.invalid_id", "Invalid id"); return; }
  const ctx = await hotlistParticipantUserIds(jobId);
  if (!canParticipateHotlist(session, ctx)) { sendApiError(res, 403, "auth.forbidden", "Forbidden"); return; }

  const { content, attachments } = req.body ?? {};
  const text = String(content ?? "").trim();
  const atts = Array.isArray(attachments) ? attachments.filter((a) => typeof a === "string" && isSafeAttachmentUrl(a)) : [];
  if (!text && !atts.length) { sendApiError(res, 400, "comment.content_required", "content or attachments required"); return; }

  const tokens = extractMentionTokens(text);
  const mentionIds = await resolveMentionUserIds(tokens, ctx.ids);

  const [row] = await withSerialInsertRetry("hotlist_comments", () =>
    db
      .insert(hotlistCommentsTable)
      .values({
        jobId,
        content: text || "[photo]",
        attachments: atts.length ? atts : null,
        mentions: mentionIds.length ? mentionIds : null,
        createdById: session.userId,
      })
      .returning(),
  );

  const mentionSet = new Set(mentionIds);
  const others = ctx.ids.filter((u) => u !== session.userId && !mentionSet.has(u));
  const me = session.displayName || "Someone";
  const link = `/?hotlistJob=${jobId}#comment-${row.id}`;
  const preview = text.slice(0, 120) || "[photo]";

  if (mentionIds.length) {
    await notifyUsers(
      mentionIds.filter((u) => u !== session.userId),
      {
        type: "comment_mention",
        title: `${me} mentioned you on a Hotlist job`,
        body: preview,
        link,
        dedupeKey: `hotlist_comment_mention:${row.id}`,
      },
    );
  }
  if (others.length) {
    await notifyUsers(others, {
      type: "hotlist_comment_added",
      title: `${me} commented on a Hotlist job`,
      body: preview,
      link,
      dedupeKey: `hotlist_comment_added:${row.id}`,
    });
  }

  // Task #676 — push the new comment onto the hotlist comment events bus
  // so any open CommentsPanel viewing this job re-fetches and renders the
  // new note without the user touching Refresh.
  publishHotlistCommentEvent({
    type: "hotlist.comment.created",
    jobId,
    commentId: row.id,
    partnerId: ctx.partnerId,
    bidderVendorIds: ctx.bidderVendorIds,
  });

  res.status(201).json(row);
  } catch (err) {
    req.log.error({ err, jobId: req.params.id }, "POST /hotlist/jobs/:id/comments failed");
    sendApiError(res, 500, "comment.create_failed", "Failed to post comment");
  }
});

router.patch("/hotlist/jobs/:id/comments/:commentId", async (req: Request, res: Response): Promise<void> => {
  const session = getSession(req);
  if (!session) { sendApiError(res, 401, "auth.not_authenticated", "Unauthorized"); return; }
  const jobId = parseInt(String(req.params.id));
  const commentId = parseInt(String(req.params.commentId));
  if (isNaN(jobId) || isNaN(commentId)) { sendApiError(res, 400, "validation.invalid_id", "Invalid id"); return; }
  const ctx = await hotlistParticipantUserIds(jobId);
  if (!canParticipateHotlist(session, ctx)) { sendApiError(res, 403, "auth.forbidden", "Forbidden"); return; }
  const [existing] = await db.select().from(hotlistCommentsTable).where(eq(hotlistCommentsTable.id, commentId));
  if (!existing || existing.jobId !== jobId) { sendApiError(res, 404, "comment.not_found", "Not found"); return; }
  if (existing.deletedAt) { sendApiError(res, 400, "comment.removed", "Comment removed"); return; }
  if (existing.createdById !== session.userId) { sendApiError(res, 403, "comment.not_editable", "Only the author can edit"); return; }

  const within = Date.now() - new Date(existing.createdAt).getTime() < EDIT_WINDOW_MS;
  const { content } = req.body ?? {};
  const newText = String(content ?? "").trim();
  if (!newText) { sendApiError(res, 400, "comment.content_required", "content required"); return; }

  if (within) {
    const history = parseEditHistory(existing.editHistory);
    history.push({ at: new Date().toISOString(), prev: existing.content });
    const [updated] = await db
      .update(hotlistCommentsTable)
      .set({ content: newText, editHistory: history, updatedAt: new Date() })
      .where(eq(hotlistCommentsTable.id, commentId))
      .returning();
    // Task #676 — push the edit so other open panels re-fetch and pick up
    // the new content + the "edited" badge without a manual refresh.
    publishHotlistCommentEvent({
      type: "hotlist.comment.updated",
      jobId,
      commentId,
      partnerId: ctx.partnerId,
      bidderVendorIds: ctx.bidderVendorIds,
    });
    res.json(updated);
    return;
  }

  const quotedBody = `> ${existing.content.replace(/\n/g, "\n> ")}\n\n${newText}`;
  const tokens = extractMentionTokens(newText);
  const mentionIds = await resolveMentionUserIds(tokens, ctx.ids);
  const [row] = await db
    .insert(hotlistCommentsTable)
    .values({
      jobId,
      content: quotedBody,
      mentions: mentionIds.length ? mentionIds : null,
      createdById: session.userId,
    })
    .returning();
  // Task #676 — past-edit-window edits are persisted as a brand-new
  // quoted-reply row, so push a `created` event (matches the POST handler's
  // semantics and what other panels need to render).
  publishHotlistCommentEvent({
    type: "hotlist.comment.created",
    jobId,
    commentId: row.id,
    partnerId: ctx.partnerId,
    bidderVendorIds: ctx.bidderVendorIds,
  });
  res.status(201).json(row);
});

router.delete("/hotlist/jobs/:id/comments/:commentId", async (req: Request, res: Response): Promise<void> => {
  const session = getSession(req);
  if (!session) { sendApiError(res, 401, "auth.not_authenticated", "Unauthorized"); return; }
  const jobId = parseInt(String(req.params.id));
  const commentId = parseInt(String(req.params.commentId));
  if (isNaN(jobId) || isNaN(commentId)) { sendApiError(res, 400, "validation.invalid_id", "Invalid id"); return; }
  const ctx = await hotlistParticipantUserIds(jobId);
  if (!canParticipateHotlist(session, ctx)) { sendApiError(res, 403, "auth.forbidden", "Forbidden"); return; }
  const [existing] = await db.select().from(hotlistCommentsTable).where(eq(hotlistCommentsTable.id, commentId));
  if (!existing || existing.jobId !== jobId) { sendApiError(res, 404, "comment.not_found", "Not found"); return; }
  const isAuthor = existing.createdById === session.userId;
  if (!isAuthor && session.role !== "admin") { sendApiError(res, 403, "comment.not_deletable", "Only the author or admin can remove"); return; }
  if (existing.deletedAt) { res.json({ ok: true }); return; }
  await db
    .update(hotlistCommentsTable)
    .set({ deletedAt: new Date(), deletedById: session.userId })
    .where(eq(hotlistCommentsTable.id, commentId));
  // Task #676 — push the soft-delete so other panels switch the row to
  // the "[removed]" placeholder without waiting for the next focus refetch.
  publishHotlistCommentEvent({
    type: "hotlist.comment.deleted",
    jobId,
    commentId,
    partnerId: ctx.partnerId,
    bidderVendorIds: ctx.bidderVendorIds,
  });
  res.json({ ok: true });
});

// Task #52 — admin-only restore for a soft-deleted hotlist comment.
// Mirrors the ticket variant above, plus a Task #676 SSE push so any
// open panel re-fetches and renders the restored note immediately
// (we re-use `hotlist.comment.updated` since the row identity stays
// the same — only `deletedAt` flipped from set to null).
router.post("/hotlist/jobs/:id/comments/:commentId/restore", async (req: Request, res: Response): Promise<void> => {
  const session = getSession(req);
  if (!session) { sendApiError(res, 401, "auth.not_authenticated", "Unauthorized"); return; }
  if (session.role !== "admin") { sendApiError(res, 403, "auth.admin_required", "Admin role required"); return; }
  const jobId = parseInt(String(req.params.id));
  const commentId = parseInt(String(req.params.commentId));
  if (isNaN(jobId) || isNaN(commentId)) { sendApiError(res, 400, "validation.invalid_id", "Invalid id"); return; }
  const [existing] = await db.select().from(hotlistCommentsTable).where(eq(hotlistCommentsTable.id, commentId));
  if (!existing || existing.jobId !== jobId) { sendApiError(res, 404, "comment.not_found", "Not found"); return; }
  if (!existing.deletedAt) { res.json({ ok: true, restored: false }); return; }
  const ctx = await hotlistParticipantUserIds(jobId);
  const [restored] = await db
    .update(hotlistCommentsTable)
    .set({ deletedAt: null, deletedById: null })
    .where(eq(hotlistCommentsTable.id, commentId))
    .returning();
  publishHotlistCommentEvent({
    type: "hotlist.comment.updated",
    jobId,
    commentId,
    partnerId: ctx.partnerId,
    bidderVendorIds: ctx.bidderVendorIds,
  });
  res.json({ ok: true, restored: true, comment: restored });
});

// ── Hotlist comment events stream (SSE) — Task #676 ──
//
// Push channel for the CommentsPanel hotlist branch so it can stop
// rendering the deliberate "Not live" pill + manual Refresh button
// (Task #672) and instead drive the same Live / Reconnecting… /
// Reconnected — refreshed pill the ticket-comments branch already uses.
//
// Visibility mirrors `canParticipateHotlist`: only admin, the job's
// partner, or a vendor with at least one bid on the job receives events.
// We additionally scope each connection to a single jobId so a dispatcher
// viewing one hotlist's panel doesn't get a refresh hint when an
// unrelated hotlist's comment changes — the panel is per-job and would
// re-fetch the wrong thread.
//
// Like /api/tickets/events, we emit a one-shot `hotlist.comment.hello`
// carrying the current global sequence so an EventSource reconnect
// (Last-Event-ID) can detect that it missed events while disconnected.
router.get("/hotlist/jobs/:id/comments/events", async (req: Request, res: Response): Promise<void> => {
  const session = getSession(req);
  if (!session) { sendApiError(res, 401, "auth.not_authenticated", "Unauthorized"); return; }
  const jobId = parseInt(String(req.params.id));
  if (isNaN(jobId)) { sendApiError(res, 400, "validation.invalid_id", "Invalid id"); return; }

  // Authorize against the same participant set the REST endpoints use,
  // and snapshot the visibility context. We re-resolve per-event below
  // because newly-added bidders won't show up in this snapshot — but the
  // event payload itself carries a fresh `bidderVendorIds` snapshot
  // taken at publish time, so the per-event check stays correct.
  const ctx = await hotlistParticipantUserIds(jobId);
  if (!canParticipateHotlist(session, ctx)) { sendApiError(res, 403, "auth.forbidden", "Forbidden"); return; }

  const visible = (ev: PublishedHotlistCommentEvent): boolean => {
    if (ev.jobId !== jobId) return false;
    if (session.role === "admin") return true;
    if (session.role === "partner") {
      if (!session.partnerId) return false;
      return ev.partnerId === session.partnerId;
    }
    if (session.role === "vendor") {
      if (!session.vendorId) return false;
      return ev.bidderVendorIds.includes(session.vendorId);
    }
    return false;
  };

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();
  res.write(`: connected\n\n`);

  const lastEventIdHeader = req.header("Last-Event-ID");
  const lastSeenSeqRaw =
    lastEventIdHeader != null ? Number(lastEventIdHeader) : NaN;
  const lastSeenSeq = Number.isFinite(lastSeenSeqRaw) ? lastSeenSeqRaw : null;
  void getCurrentHotlistCommentEventSeq()
    .then((currentSeq) => {
      const gap = lastSeenSeq != null && currentSeq > lastSeenSeq;
      const hello = {
        type: "hotlist.comment.hello" as const,
        currentSeq,
        lastSeenSeq,
        gap,
      };
      try {
        res.write(`event: hotlist.comment.hello\n`);
        res.write(`data: ${JSON.stringify(hello)}\n\n`);
      } catch {
        /* client gone */
      }
    })
    .catch(() => {
      /* swallow — clients still get live events */
    });

  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      /* ignore */
    }
  }, 25000);

  const unsubscribe = subscribeHotlistCommentEvents((ev) => {
    if (!visible(ev)) return;
    try {
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

// Endpoint to list participants suitable for mention picker
router.get("/tickets/:id/comments-participants", async (req: Request, res: Response): Promise<void> => {
  const session = getSession(req);
  if (!session) { sendApiError(res, 401, "auth.not_authenticated", "Unauthorized"); return; }
  const ticketId = parseInt(String(req.params.id));
  if (isNaN(ticketId)) { sendApiError(res, 400, "validation.invalid_id", "Invalid id"); return; }
  // Task #698: per-session, role-aware rate limit on the mention
  // picker. Applied BEFORE the participant-graph lookup so a bug
  // re-rendering the picker on every keystroke or a bot scraping
  // participants across thread ids gets throttled rather than
  // repeatedly running the participant + users-by-id fan-out.
  if (!await enforceParticipantsRateLimit(req, res, session)) return;
  const ctx = await ticketParticipantUserIds(ticketId);
  if (!canParticipateTicket(session, ctx)) { sendApiError(res, 403, "auth.forbidden", "Forbidden"); return; }
  if (!ctx.ids.length) { res.json([]); return; }
  const users = await db
    .select({ id: usersTable.id, displayName: usersTable.displayName, role: usersTable.role, username: usersTable.username })
    .from(usersTable)
    .where(sql`${usersTable.id} IN (${sql.join(ctx.ids.map((i) => sql`${i}`), sql`, `)})`);
  res.json(users);
});

router.get("/hotlist/jobs/:id/comments-participants", async (req: Request, res: Response): Promise<void> => {
  const session = getSession(req);
  if (!session) { sendApiError(res, 401, "auth.not_authenticated", "Unauthorized"); return; }
  const jobId = parseInt(String(req.params.id));
  if (isNaN(jobId)) { sendApiError(res, 400, "validation.invalid_id", "Invalid id"); return; }
  // Task #698: per-session, role-aware rate limit on the mention
  // picker. Shares the participants-resource budget with the ticket
  // variant above so an attacker sweeping job ids burns down the
  // same window as one sweeping ticket ids.
  if (!await enforceParticipantsRateLimit(req, res, session)) return;
  const ctx = await hotlistParticipantUserIds(jobId);
  if (!canParticipateHotlist(session, ctx)) { sendApiError(res, 403, "auth.forbidden", "Forbidden"); return; }
  if (!ctx.ids.length) { res.json([]); return; }
  const users = await db
    .select({ id: usersTable.id, displayName: usersTable.displayName, role: usersTable.role, username: usersTable.username })
    .from(usersTable)
    .where(sql`${usersTable.id} IN (${sql.join(ctx.ids.map((i) => sql`${i}`), sql`, `)})`);
  res.json(users);
});

// ============================================================
// ADMIN — REMOVED COMMENTS AUDIT (Task #52)
// ============================================================
//
// One-stop list of every soft-deleted comment across both
// `ticket_note_logs` and `hotlist_comments` in a recent window
// (default last 30 days, capped at 365). Admin-only — partners /
// vendors / field employees would never see deleted comments anyway,
// and the page deliberately includes the original content so it must
// stay locked down to system admins.
//
// We deliberately resolve display names server-side here rather than
// returning bare user IDs so the audit page can render in one fetch
// without forcing the client to also pull a participants roster.
router.get("/admin/removed-comments", async (req: Request, res: Response): Promise<void> => {
  const session = getSession(req);
  if (!session) { sendApiError(res, 401, "auth.not_authenticated", "Unauthorized"); return; }
  if (session.role !== "admin") { sendApiError(res, 403, "auth.admin_required", "Admin role required"); return; }

  const rawDays = parseInt(String(req.query.days ?? "30"));
  const days = Number.isFinite(rawDays) && rawDays > 0 ? Math.min(rawDays, 365) : 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const deletedByUsers = aliasedTable(usersTable, "deleted_by_user");
  const ticketRows = await db
    .select({
      id: ticketNoteLogsTable.id,
      parentId: ticketNoteLogsTable.ticketId,
      content: ticketNoteLogsTable.content,
      attachments: ticketNoteLogsTable.attachments,
      createdAt: ticketNoteLogsTable.createdAt,
      createdById: ticketNoteLogsTable.createdById,
      createdByName: usersTable.displayName,
      deletedAt: ticketNoteLogsTable.deletedAt,
      deletedById: ticketNoteLogsTable.deletedById,
      deletedByName: deletedByUsers.displayName,
    })
    .from(ticketNoteLogsTable)
    .leftJoin(usersTable, eq(ticketNoteLogsTable.createdById, usersTable.id))
    .leftJoin(deletedByUsers, eq(ticketNoteLogsTable.deletedById, deletedByUsers.id))
    .where(and(isNotNull(ticketNoteLogsTable.deletedAt), gte(ticketNoteLogsTable.deletedAt, since)));

  const hotlistRows = await db
    .select({
      id: hotlistCommentsTable.id,
      parentId: hotlistCommentsTable.jobId,
      content: hotlistCommentsTable.content,
      attachments: hotlistCommentsTable.attachments,
      createdAt: hotlistCommentsTable.createdAt,
      createdById: hotlistCommentsTable.createdById,
      createdByName: usersTable.displayName,
      deletedAt: hotlistCommentsTable.deletedAt,
      deletedById: hotlistCommentsTable.deletedById,
      deletedByName: deletedByUsers.displayName,
    })
    .from(hotlistCommentsTable)
    .leftJoin(usersTable, eq(hotlistCommentsTable.createdById, usersTable.id))
    .leftJoin(deletedByUsers, eq(hotlistCommentsTable.deletedById, deletedByUsers.id))
    .where(and(isNotNull(hotlistCommentsTable.deletedAt), gte(hotlistCommentsTable.deletedAt, since)));

  const items = [
    ...ticketRows.map((r) => ({ source: "ticket" as const, ...r, attachmentCount: r.attachments?.length ?? 0 })),
    ...hotlistRows.map((r) => ({ source: "hotlist" as const, ...r, attachmentCount: r.attachments?.length ?? 0 })),
  ].sort((a, b) => {
    // Newest deletion first; deletedAt is non-null because of the WHERE.
    const ta = a.deletedAt ? new Date(a.deletedAt).getTime() : 0;
    const tb = b.deletedAt ? new Date(b.deletedAt).getTime() : 0;
    return tb - ta;
  });

  res.json({ days, since: since.toISOString(), items });
});

export default router;
