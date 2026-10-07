import { Router } from "express";
import { ZodError } from "zod/v4";
import { getSessionFromRequest } from "../lib/session";
import { ticketInvoicePreparationForSession } from "../services/ticket-invoice-preparation-repository";

const router = Router();
for (const action of ["execute", "readback"] as const) {
  router.post(`/invoices/ticket-preparation/${action}`, async (req, res) => {
    const session = getSessionFromRequest(req);
    if (!session) { res.status(401).json({ error: "Unauthorized" }); return; }
    try {
      const receipt = await ticketInvoicePreparationForSession(session)[action](req.body);
      res.json({ receipt });
    } catch (error) {
      if (error instanceof ZodError) { res.status(400).json({ error: "Invalid invoice preparation request" }); return; }
      const code = error instanceof Error ? error.message : "";
      const denied = ["invoice_preparation.current_vendor_required", "invoice_preparation.current_authority_required", "invoice_preparation.billing_permission_required", "invoice_activity.current_company_required", "invoice_activity.current_authority_required", "invoice_activity.billing_permission_required"];
      const conflict = ["invoice_preparation.operation_conflict", "invoice_preparation.ticket_conflict", "invoice_preparation.ticket_already_invoiced"];
      res.status(denied.includes(code) ? 403 : conflict.includes(code) ? 409 : 422).json({ error: "Invoice preparation unavailable" });
    }
  });
}
export default router;
