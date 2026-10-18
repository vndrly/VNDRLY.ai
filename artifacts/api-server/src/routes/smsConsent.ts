import { Router, type IRouter } from "express";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, notificationPreferencesTable, usersTable, workHubAuditLogTable } from "@workspace/db";
import { LEGAL_POLICY_VERSION, PUBLIC_SMS_CONSENT_DISCLOSURE } from "@workspace/api-zod/legal-policy";
import { getSessionFromRequest } from "../lib/session";
import { isE164Phone } from "../lib/twilio";
import { loadGateAlertRecipient } from "../services/gate-alert-repository";
import { buildGateAlertConsentPatch } from "../services/gate-alert-delivery";
import { enforceNotificationsRateLimit } from "../lib/notifications-rate-limit";

const router: IRouter = Router();
const source = "https://vndrly.ai/sms/";

// The public form is readable without login or JavaScript. Saving is an authenticated,
// same-origin operation; it cannot enroll a different user or send a verification SMS.
router.post("/notifications/sms-consent", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const session = getSessionFromRequest(req);
  if (!session?.userId) return res.status(401).json({ message: "Sign in to VNDRLY, then return to this form to save your SMS choice." });
  if (session.publicDemo || session.realm === "demo") return res.status(403).json({ message: "Demo accounts cannot enroll in live SMS." });
  if (!["https://vndrly.ai", "https://www.vndrly.ai"].includes(req.get("Origin") ?? "")) {
    return res.status(403).json({ message: "Open the SMS consent form on vndrly.ai to save your choice." });
  }
  const body = req.body ?? {};
  const phone = typeof body.phone === "string" ? body.phone.trim().replace(/[ ()-]/g, "") : "";
  if (body.consent !== "yes" || body.policyVersion !== LEGAL_POLICY_VERSION || !isE164Phone(phone)) {
    return res.status(400).json({ message: "Enter your mobile number with country code and select the optional SMS consent checkbox to enroll." });
  }
  if (!await enforceNotificationsRateLimit(req, res, { userId: session.userId, role: session.role })) return;
  // Read before the transaction so a full connection pool cannot deadlock on
  // a second connection while holding the user's row lock.
  const recipient = await loadGateAlertRecipient(session.userId);
  if (!recipient || recipient.session.sv !== session.sv || (recipient.membershipId ?? null) !== (session.activeMembershipId ?? null)) return res.status(409).json({ message: "Your account changed. Sign in again before enrolling." });
  if (recipient.gate && recipient.phone !== phone) return res.status(400).json({ message: "Use the mobile number saved on your current Gate employee profile. Ask your company administrator to correct that profile first if needed." });
  const result = await db.transaction(async tx => {
    // Serialize with membership changes and invalidate revoked sessions even if the
    // shared session guard cannot reach the database. No fail-open consent writes.
    const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, session.userId!)).for("update");
    if (!user || user.suspendedAt || user.sessionVersion !== session.sv || (user.activeMembershipId ?? null) !== (session.activeMembershipId ?? null)) return { status: 409, message: "Your account changed. Sign in again before enrolling." };
    const consentedAt = new Date();
    const record = { phone, policyVersion: LEGAL_POLICY_VERSION, disclosure: PUBLIC_SMS_CONSENT_DISCLOSURE, consentedAt: consentedAt.toISOString(), source, membershipId: recipient.membershipId };
    const gatePatch = recipient.gate ? buildGateAlertConsentPatch(true, recipient, consentedAt) : {};
    const patch = { smsConsentRecord: record, ...gatePatch };
    await tx.insert(notificationPreferencesTable).values({ userId: session.userId!, ...patch }).onConflictDoUpdate({ target: notificationPreferencesTable.userId, set: patch });
    // Preserve earlier evidence when a user changes their number or enrolls again.
    // Audit readers do not receive raw mobile numbers.
    await tx.insert(workHubAuditLogTable).values({
      actorUserId: session.userId!, ownerOrgType: session.vendorId ? "vendor" : session.partnerId ? "partner" : "platform",
      ownerOrgId: session.vendorId ?? session.partnerId ?? 0, action: "sms_consent_granted", subjectType: "sms_consent", subjectId: String(session.userId), source: "public_sms_form",
      metadata: { ...record, phone: undefined, phoneHash: createHash("sha256").update(phone).digest("hex"), gateAlertsEnabled: recipient.gate },
    });
    return { status: 200, saved: true, consentedAt: record.consentedAt, gateAlertsEnabled: recipient.gate, messageSent: false,
      message: "Your SMS consent is saved. Messages are limited to supported workflows and remain subject to campaign approval and any carrier STOP block. Reply START to the VNDRLY number to reverse a prior carrier STOP; this form cannot remove that block." };
  });
  const { status, ...payload } = result;
  return res.status(status).json(payload);
});
export default router;
