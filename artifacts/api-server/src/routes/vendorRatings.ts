import { Router, type IRouter } from "express";
import { eq, and, desc, sql, isNull } from "drizzle-orm";
import crypto from "crypto";
import {
  db,
  vendorRatingsTable,
  partnersTable,
  usersTable,
  vendorsTable,
  ticketsTable,
  siteLocationsTable,
  partnerVendorRelationshipsTable,
} from "@workspace/db";
import {
  VendorRatingParams,
  UpsertVendorRatingBody,
  GetVendorRatingsResponse,
} from "@workspace/api-zod";
import { sendResponse } from "../lib/typed-response";

import { SESSION_SECRET } from "../lib/session";

import { sendValidationFailed } from "../lib/validation-error";
const COOKIE_NAME = "vndrly_session";
type Session = { userId: number; role: string; vendorId: number | null; partnerId: number | null };
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

const router: IRouter = Router();

router.get("/vendors/:vendorId/ratings", async (req, res): Promise<void> => {
  const params = VendorRatingParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error, { code: "validation.invalid_input" });
    return;
  }
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  if (
    session.role !== "admin" &&
    session.role !== "partner" &&
    session.role !== "vendor" &&
    session.role !== "field_employee"
  ) {
    res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
    return;
  }
  // Vendor admins and field employees (foreman portal chrome) may read
  // aggregate ratings for their own employer only — not other vendors.
  if (
    (session.role === "vendor" || session.role === "field_employee") &&
    session.vendorId !== params.data.vendorId
  ) {
    res.status(403).json({ error: "Forbidden", code: "auth.forbidden" });
    return;
  }
  const rows = await db
    .select({
      id: vendorRatingsTable.id,
      vendorId: vendorRatingsTable.vendorId,
      partnerId: vendorRatingsTable.partnerId,
      partnerName: partnersTable.name,
      userId: vendorRatingsTable.userId,
      userDisplayName: usersTable.displayName,
      ticketId: vendorRatingsTable.ticketId,
      rating: vendorRatingsTable.rating,
      review: vendorRatingsTable.review,
      createdAt: vendorRatingsTable.createdAt,
      updatedAt: vendorRatingsTable.updatedAt,
    })
    .from(vendorRatingsTable)
    .innerJoin(partnersTable, eq(vendorRatingsTable.partnerId, partnersTable.id))
    .innerJoin(usersTable, eq(vendorRatingsTable.userId, usersTable.id))
    .where(eq(vendorRatingsTable.vendorId, params.data.vendorId))
    .orderBy(desc(vendorRatingsTable.updatedAt));

  // Average across EVERY rating row for this vendor — both the
  // standalone per-partner ratings and the per-ticket ratings the
  // approve flow now stamps. Each ticket approval contributes one
  // additional sample, so the displayed average and count both move
  // every time a partner rates a completed job.
  const count = rows.length;
  const average = count === 0 ? null : rows.reduce((s, r) => s + r.rating, 0) / count;
  // `myRating` continues to mean "the standalone per-partner row"
  // — the one the existing `Your Rating` panel on the vendor page
  // edits via this same endpoint without a ticketId. Per-ticket
  // rows show up as separate entries in `items` instead.
  const myRating =
    session && session.role === "partner" && session.partnerId
      ? rows.find((r) => r.partnerId === session.partnerId && r.ticketId === null) ?? null
      : null;

  sendResponse(res, GetVendorRatingsResponse, {
    average,
    count,
    myRating,
    items: rows,
  });
});

router.post("/vendors/:vendorId/ratings", async (req, res): Promise<void> => {
  const params = VendorRatingParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error, { code: "validation.invalid_input" });
    return;
  }
  const parsed = UpsertVendorRatingBody.safeParse(req.body);
  if (!parsed.success) {
    sendValidationFailed(res, parsed.error, { code: "validation.invalid_input" });
    return;
  }
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  if (session.role !== "partner" || !session.partnerId) {
    res.status(403).json({ error: "Only partners can rate vendors", code: "rating.partner_only" });
    return;
  }

  const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, params.data.vendorId));
  if (!vendor) {
    res.status(404).json({ error: "Vendor not found", code: "vendor.not_found" });
    return;
  }

  const review = parsed.data.review ?? null;
  const ticketId = parsed.data.ticketId ?? null;

  // Per-ticket rating path. We require the ticket to belong to this
  // vendor AND to a site owned by the rating partner — same access
  // shape the approve route enforces. This keeps a partner from
  // padding another partner's vendor average via a hand-crafted
  // payload.
  if (ticketId !== null) {
    const [ticketRow] = await db
      .select({
        id: ticketsTable.id,
        vendorId: ticketsTable.vendorId,
        partnerId: siteLocationsTable.partnerId,
      })
      .from(ticketsTable)
      .innerJoin(siteLocationsTable, eq(ticketsTable.siteLocationId, siteLocationsTable.id))
      .where(eq(ticketsTable.id, ticketId));
    if (!ticketRow) {
      res.status(404).json({ error: "Ticket not found", code: "ticket.not_found" });
      return;
    }
    if (ticketRow.vendorId !== params.data.vendorId) {
      res.status(400).json({
        error: "Ticket does not belong to this vendor",
        code: "rating.ticket_vendor_mismatch",
      });
      return;
    }
    if (ticketRow.partnerId !== session.partnerId) {
      res.status(403).json({
        error: "Only the owning partner can rate this ticket",
        code: "rating.ticket_partner_mismatch",
      });
      return;
    }

    // Insert a NEW per-ticket row. If the partner re-opens the same
    // ticket and re-rates, update that ticket's existing row in
    // place — keeping the per-ticket sample count stable.
    const [row] = await db
      .insert(vendorRatingsTable)
      .values({
        vendorId: params.data.vendorId,
        partnerId: session.partnerId,
        userId: session.userId,
        ticketId,
        rating: parsed.data.rating,
        review,
      })
      .onConflictDoUpdate({
        target: vendorRatingsTable.ticketId,
        targetWhere: sql`${vendorRatingsTable.ticketId} IS NOT NULL`,
        set: {
          rating: parsed.data.rating,
          review,
          userId: session.userId,
          updatedAt: sql`now()`,
        },
      })
      .returning();

    // Mirror the standalone-rating side effect: stamp the
    // (partner, vendor) relationship as preferred on first contact.
    await db
      .insert(partnerVendorRelationshipsTable)
      .values({
        partnerId: session.partnerId,
        vendorId: params.data.vendorId,
        status: "preferred",
        ratedAt: sql`now()`,
      })
      .onConflictDoNothing({
        target: [
          partnerVendorRelationshipsTable.partnerId,
          partnerVendorRelationshipsTable.vendorId,
        ],
      });

    res.status(200).json(row);
    return;
  }

  // Standalone per-partner upsert path (legacy "Your Rating" panel
  // on the vendor page). Targets the partial unique index that
  // covers rows where ticket_id IS NULL.
  const [row] = await db
    .insert(vendorRatingsTable)
    .values({
      vendorId: params.data.vendorId,
      partnerId: session.partnerId,
      userId: session.userId,
      ticketId: null,
      rating: parsed.data.rating,
      review,
    })
    .onConflictDoUpdate({
      target: [vendorRatingsTable.vendorId, vendorRatingsTable.partnerId],
      targetWhere: sql`${vendorRatingsTable.ticketId} IS NULL`,
      set: { rating: parsed.data.rating, review, userId: session.userId, updatedAt: sql`now()` },
    })
    .returning();

  // After a partner rates a vendor for the first time, auto-promote the
  // (partner, vendor) pair to the "preferred" relationship status. This is
  // the path through which an unaffiliated vendor becomes preferred. We
  // never downgrade an existing relationship here — `onConflictDoNothing`
  // leaves an already-approved or already-preferred row untouched and only
  // keeps the original ratedAt timestamp from the very first rating.
  await db
    .insert(partnerVendorRelationshipsTable)
    .values({
      partnerId: session.partnerId,
      vendorId: params.data.vendorId,
      status: "preferred",
      ratedAt: sql`now()`,
    })
    .onConflictDoNothing({
      target: [
        partnerVendorRelationshipsTable.partnerId,
        partnerVendorRelationshipsTable.vendorId,
      ],
    });

  res.status(200).json(row);
});

router.delete("/vendors/:vendorId/ratings", async (req, res): Promise<void> => {
  const params = VendorRatingParams.safeParse(req.params);
  if (!params.success) {
    sendValidationFailed(res, params.error, { code: "validation.invalid_input" });
    return;
  }
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return;
  }
  if (session.role !== "partner" || !session.partnerId) {
    res.status(403).json({ error: "Only partners can manage their rating", code: "rating.partner_manage_only" });
    return;
  }
  // DELETE only removes the partner's standalone "Your Rating" row.
  // Per-ticket ratings are removed via the ticket lifecycle (cascade
  // on ticket deletion) — partners cannot retroactively wipe a
  // ticket-bound rating from this endpoint.
  await db
    .delete(vendorRatingsTable)
    .where(
      and(
        eq(vendorRatingsTable.vendorId, params.data.vendorId),
        eq(vendorRatingsTable.partnerId, session.partnerId),
        isNull(vendorRatingsTable.ticketId),
      ),
    );
  res.sendStatus(204);
});

export default router;
