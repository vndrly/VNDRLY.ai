import { Router, type Request, type Response } from "express";
import { z } from "zod/v4";
import { getSessionFromRequest } from "../lib/session";
import { ManagedSubcontractorError } from "../services/managed-subcontractors";
import {
  approveManagedSubcontractorHours,
  correctManagedSubcontractorHours,
  getManagedSubcontractorHoursReport,
  updateManagedSubcontractorHoursSettings,
} from "../services/managed-subcontractor-hours-store";
import { renderManagedSubcontractorHoursPdf } from "../lib/managed-subcontractor-hours-pdf";
import { sendManagedSubcontractorHoursEmail } from "../lib/managed-subcontractor-hours-email";
import { listManagedSubcontractorHoursOrganizations } from "../services/managed-subcontractor-hours-list";

const router = Router();
const Id = z.string().uuid();
const Range = z.object({ start: z.iso.datetime(), end: z.iso.datetime() });
const base = "/vendors/:vendorId/managed-subcontractors/:organizationId/hours";

function actor(req: Request) {
  const session = getSessionFromRequest(req);
  const vendorId = z.coerce.number().int().positive().parse(req.params.vendorId);
  const managedSupervisor = Boolean(session?.managedSubcontractor?.siteGrants.some((grant) => grant.role === "gate_supervisor"));
  const contractorSupervisor = session?.membershipRole === "admin" || ["office", "both", "gate_supervisor"].includes(session?.vendorRole ?? "");
  if (!session?.userId || session.vendorId !== vendorId || (!managedSupervisor && !contractorSupervisor)) {
    throw new ManagedSubcontractorError("Hours report supervisor access required", 403, "managed_subcontractor.hours_access_required");
  }
  return { userId: session.userId, vendorId, side: session.managedSubcontractor ? "subcontractor" as const : "contractor" as const, admin: session.membershipRole === "admin" };
}

function sendError(res: Response, error: unknown) {
  if (error instanceof ManagedSubcontractorError) return void res.status(error.status).json({ error: error.message, code: error.code });
  if (error instanceof z.ZodError) return void res.status(400).json({ error: "Invalid hours report request", code: "managed_subcontractor.invalid_hours_request", details: error.issues });
  console.error("Managed subcontractor hours request failed", error);
  res.status(500).json({ error: "Managed subcontractor hours request failed", code: "managed_subcontractor.hours_internal_error" });
}

function requestArgs(req: Request) {
  const who = actor(req);
  const range = Range.parse(req.query);
  return { ...who, organizationId: Id.parse(req.params.organizationId), ...range };
}

router.get("/vendors/:vendorId/managed-subcontractors/hours-access", async (req, res) => {
  try {
    const who = actor(req);
    res.json(await listManagedSubcontractorHoursOrganizations({ userId: who.userId, vendorId: who.vendorId, managedWorker: who.side === "subcontractor" }));
  } catch (error) { sendError(res, error); }
});

router.get(base, async (req, res) => {
  try { res.json(await getManagedSubcontractorHoursReport(requestArgs(req))); } catch (error) { sendError(res, error); }
});

router.post(`${base}/approve`, async (req, res) => {
  try {
    const args = requestArgs(req);
    res.json(await approveManagedSubcontractorHours({ ...args, side: args.side }));
  } catch (error) { sendError(res, error); }
});

router.patch(`${base}/corrections`, async (req, res) => {
  try {
    const args = requestArgs(req);
    const correction = z.object({ shiftId: z.string().uuid(), userId: z.number().int().positive(), actualStart: z.iso.datetime(), actualEnd: z.iso.datetime(), reason: z.string().trim().min(3).max(500) }).strict().parse(req.body);
    res.json(await correctManagedSubcontractorHours({ ...args, correction }));
  } catch (error) { sendError(res, error); }
});

router.patch(`${base}/settings`, async (req, res) => {
  try {
    const args = requestArgs(req);
    if (!args.admin) throw new ManagedSubcontractorError("Vendor administrator access required", 403, "managed_subcontractor.vendor_admin_required");
    const settings = z.object({ policy: z.enum(["contractor", "subcontractor", "either", "dual"]), recipients: z.array(z.email()).max(50) }).strict().parse(req.body);
    res.json(await updateManagedSubcontractorHoursSettings({ ...args, ...settings }));
  } catch (error) { sendError(res, error); }
});

router.get(`${base}/pdf`, async (req, res) => {
  try {
    const report = await getManagedSubcontractorHoursReport(requestArgs(req));
    const pdf = await renderManagedSubcontractorHoursPdf(report);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${report.organization.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-approved-hours.pdf"`);
    res.send(pdf);
  } catch (error) { sendError(res, error); }
});

router.post(`${base}/email`, async (req, res) => {
  try {
    const args = requestArgs(req);
    const report = await getManagedSubcontractorHoursReport(args);
    const requested = z.object({ recipients: z.array(z.email()).max(50).optional() }).strict().parse(req.body ?? {});
    const recipients = requested.recipients?.length ? requested.recipients : report.recipients;
    if (!recipients.length) throw new ManagedSubcontractorError("Add at least one hours report recipient", 400, "managed_subcontractor.hours_recipient_required");
    const pdf = await renderManagedSubcontractorHoursPdf(report);
    const sent = await sendManagedSubcontractorHoursEmail({ recipients, contractorName: report.sponsor.name, subcontractorName: report.organization.name, start: report.range.start, end: report.range.end, pdf });
    res.json({ sent: true, recipientCount: recipients.length, messageId: sent.messageId });
  } catch (error) { sendError(res, error); }
});

export default router;
