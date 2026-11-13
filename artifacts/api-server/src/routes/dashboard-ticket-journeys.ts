import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getSessionFromRequest, requireSession } from "../lib/session";

export const dashboardTicketJourneysRouter = Router();
function dates(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key,
    value != null && ["createdAt", "updatedAt", "approvedAt", "cancelledAt", "paidAt", "finishedAt", "at"].includes(key)
      ? new Date(value as string).toISOString() : value]));
}

dashboardTicketJourneysRouter.get("/dashboard/ticket-journeys", requireSession, async (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session) { res.status(401).json({ error: "Not authenticated" }); return; }
  const scope = session.role === "vendor" && session.vendorId
    ? sql`t.vendor_id=${session.vendorId}`
    : session.role === "partner" && session.partnerId
      ? sql`s.partner_id=${session.partnerId}` : sql`${session.role === "admin"}`;
  const result = await db.execute(sql`
    SELECT t.id, t.status, t.created_at AS "createdAt", t.updated_at AS "updatedAt",
      t.approved_at AS "approvedAt", t.cancelled_at AS "cancelledAt", t.kickback_reason AS "kickbackReason",
      s.name AS "siteName", p.name AS "partnerName", t.vendor_id AS "vendorId",
      payments."invoiceCount", payments."paidAmount", payments."balanceDue",
      payments."allPaid", payments."paidAt",
      CASE WHEN EXISTS (
        SELECT 1 FROM work_hub_approval_steps step WHERE step.decision='approved' AND step.request_id=(
          SELECT r.id FROM work_hub_approval_requests r WHERE r.subject_type='ticket' AND r.subject_id=t.id::text
          AND r.owner_org_type='partner' AND r.owner_org_id=s.partner_id
          ORDER BY r.created_at DESC, r.id DESC LIMIT 1)
      ) THEN 'finance' ELSE 'landman' END AS "reviewStage",
      CASE WHEN payments."invoiceCount">0 THEN payments."allPaid"
        ELSE t.status='funds_dispersed' END AS "paid",
      COALESCE(payments."paidAt", t.payment_dispersed_at, t.cancelled_at,
        (SELECT max(h.created_at) FROM ticket_status_history h
         WHERE h.ticket_id=t.id AND h.to_status IN ('cancelled','denied','funds_dispersed'))) AS "finishedAt"
    FROM tickets t JOIN site_locations s ON s.id=t.site_location_id
    LEFT JOIN partners p ON p.id=s.partner_id
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS "invoiceCount", COALESCE(sum(i.paid_amount),0)::text AS "paidAmount",
        COALESCE(sum(greatest(i.total-i.paid_amount-i.credited_amount,0)),0)::text AS "balanceDue",
        bool_and(i.status='paid') AS "allPaid", max(i.paid_at) AS "paidAt"
      FROM invoice_ticket_links l JOIN invoices i ON i.id=l.invoice_id
      WHERE l.ticket_id=t.id AND i.vendor_id=t.vendor_id AND i.partner_id=s.partner_id AND i.status<>'cancelled'
    ) payments ON true
    WHERE ${scope}
    ORDER BY t.updated_at DESC, t.id DESC
  `);
  res.json({ tickets: result.rows.map(dates) });
});

dashboardTicketJourneysRouter.get("/dashboard/ticket-journeys/:id", requireSession, async (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session) { res.status(401).json({ error: "Not authenticated" }); return; }
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid ticket" }); return; }
  const scope = session.role === "vendor" && session.vendorId
    ? sql`t.vendor_id=${session.vendorId}`
    : session.role === "partner" && session.partnerId
      ? sql`s.partner_id=${session.partnerId}` : sql`${session.role === "admin"}`;
  const owned = (await db.execute(sql`SELECT t.id, t.vendor_id, s.partner_id,
    NULLIF(trim(concat_ws(' ', employee.first_name, employee.last_name)), '') AS "assignedTo" FROM tickets t
    JOIN site_locations s ON s.id=t.site_location_id
    LEFT JOIN vendor_people employee ON employee.id=t.field_employee_id AND employee.vendor_id=t.vendor_id
    WHERE t.id=${id} AND ${scope}`)).rows[0];
  if (!owned) { res.status(404).json({ error: "Ticket not found" }); return; }
  const [history, invoices, approvals] = await Promise.all([
    db.execute(sql`SELECT h.id, h.to_status AS status, h.reason, h.created_at AS "at", u.display_name AS "actor"
      FROM ticket_status_history h LEFT JOIN users u ON u.id=h.actor_user_id
      WHERE h.ticket_id=${id} ORDER BY h.created_at, h.id`),
    db.execute(sql`SELECT i.id, i.invoice_number AS "number", i.status, i.total,
      i.paid_amount AS "paidAmount", greatest(i.total-i.paid_amount-i.credited_amount,0)::text AS "balanceDue",
      (SELECT count(*)::int FROM invoice_ticket_links links WHERE links.invoice_id=i.id) AS "ticketCount",
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',pay.id,'amount',pay.amount,'date',pay.paid_at,
        'method',pay.method,'reference',pay.reference_number,'notes',pay.notes) ORDER BY pay.paid_at DESC)
        FROM invoice_payments pay WHERE pay.invoice_id=i.id AND pay.voided_at IS NULL),'[]'::jsonb) AS payments
      FROM invoice_ticket_links l JOIN invoices i ON i.id=l.invoice_id
      WHERE l.ticket_id=${id} AND i.vendor_id=${owned.vendor_id} AND i.partner_id=${owned.partner_id} AND i.status<>'cancelled'
      ORDER BY i.id`),
    db.execute(sql`SELECT a.step_order AS "order", u.display_name AS "approver", a.decision,
      a.comment, a.decided_at AS "at" FROM work_hub_approval_steps a
      JOIN users u ON u.id=a.approver_user_id WHERE a.request_id=(
        SELECT r.id FROM work_hub_approval_requests r WHERE r.subject_type='ticket' AND r.subject_id=${String(id)}
        AND ((r.owner_org_type='partner' AND r.owner_org_id=${owned.partner_id}) OR (r.owner_org_type='vendor' AND r.owner_org_id=${owned.vendor_id}))
        ORDER BY r.created_at DESC, r.id DESC LIMIT 1) ORDER BY a.step_order, a.id`),
  ]);
  res.json({ assignedTo: owned.assignedTo ?? null, history: history.rows.map(dates), invoices: invoices.rows, approvals: approvals.rows.map(dates),
    canRecordPayment: session.role === "vendor" || session.role === "admin" });
});
