import { Router, type IRouter } from "express";
import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db, notificationPreferencesTable, usersTable, workHubAuditLogTable } from "@workspace/db";
import { LEGAL_POLICY_VERSION, PUBLIC_SMS_CONSENT_DISCLOSURE, PUBLIC_SMS_CONSENT_DISCLOSURE_ES, WORK_PHONE_SMS_VERSION, WORK_PHONE_SMS_DISCLOSURE, WORK_PHONE_SMS_DISCLOSURE_ES } from "@workspace/api-zod/legal-policy";
import { getSessionFromRequest } from "../lib/session";
import { normalizeSmsPhone } from "../lib/twilio";
import { loadSmsConsentRecipient } from "../services/gate-alert-repository";
import { buildGateAlertConsentPatch } from "../services/gate-alert-delivery";
import { enforceNotificationsRateLimit } from "../lib/notifications-rate-limit";

import { PLATFORM_EULA_VERSION } from "../lib/platform-eula-acceptance";
const router: IRouter = Router();
const source = "https://vndrly.ai/sms/";

// The public form is readable without login or JavaScript. Saving is an authenticated,
// same-origin operation; it cannot enroll a different user or send a verification SMS.
router.post("/notifications/sms-consent", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const session = getSessionFromRequest(req);
  if (!session?.userId) return res.status(401).json({ message: "Sign in to VNDRLY, then return to this form to save your SMS choice." });
  if (session.publicDemo || session.realm === "demo") return res.status(403).json({ message: "Demo accounts cannot enroll in live SMS." });
  if (!["https://vndrly.ai", "https://www.vndrly.ai"].includes(req.get("Origin") ?? "") && !/^Bearer /i.test(req.get("Authorization") ?? "") && !(process.env.NODE_ENV !== "production" && /^http:\/\/(localhost|127\.0\.0\.1):5173$/.test(req.get("Origin") ?? ""))) {
    return res.status(403).json({ message: "Open the SMS consent form on vndrly.ai to save your choice." });
  }
  const body = req.body ?? {};
  const combined = body.workPhone === true;
  if (combined && body.consent !== "no" && body.workPhoneVersion !== WORK_PHONE_SMS_VERSION) return res.status(400).json({message:"Review the current Work Phone and SMS agreement before saving."});
  const language = body.language ?? "en";
  if (language !== "en" && language !== "es") return res.status(400).json({ message: "Choose English or Spanish / Elija inglés o español." });
  const phone = typeof body.phone === "string" ? normalizeSmsPhone(body.phone) ?? "" : "";
  if (body.consent !== "no" && (body.consent !== "yes" || body.policyVersion !== LEGAL_POLICY_VERSION || !phone)) {
    return res.status(400).json({ message: "Enter your 10-digit mobile number and select the optional SMS consent checkbox to enroll." });
  }
  if (!await enforceNotificationsRateLimit(req, res, { userId: session.userId, role: session.role })) return;
  // Read before the transaction so a full connection pool cannot deadlock on
  // a second connection while holding the user's row lock.
  if (body.consent === "no") {
    await db.transaction(async tx => {
    await tx.select().from(usersTable).where(eq(usersTable.id, session.userId!)).for("update");
    await tx.update(notificationPreferencesTable).set({
      smsConsentRecord: null, ...buildGateAlertConsentPatch(false, null),
    }).where(eq(notificationPreferencesTable.userId, session.userId!));
    await tx.insert(workHubAuditLogTable).values([
      {actorUserId:session.userId!,ownerOrgType:"platform",ownerOrgId:0,action:"sms_consent_withdrawn",subjectType:"sms_consent",subjectId:String(session.userId),source:"personal_settings",metadata:{withdrawnAt:new Date().toISOString()}},
      {actorUserId:session.userId!,ownerOrgType:"platform",ownerOrgId:0,action:"personal_agreement_withdrawn",subjectType:"personal_agreement",subjectId:String(session.userId),source:"personal_settings",metadata:{document:"work_phone",version:WORK_PHONE_SMS_VERSION,withdrawn:true,withdrawnAt:new Date().toISOString()}},
    ]);
    });
    return res.json({ saved: true, enrolled: false });
  }
  const recipient = await loadSmsConsentRecipient(session.userId);
  if (!recipient || recipient.session.sv !== session.sv || (recipient.membershipId ?? null) !== (session.activeMembershipId ?? null)) return res.status(409).json({ message: "Your account changed. Sign in again before enrolling." });
  if (!combined && recipient.gate && (!recipient.phone || normalizeSmsPhone(recipient.phone) !== phone)) return res.status(400).json({ message: "Use the mobile number saved on your current Gate employee profile. Ask your company administrator to correct that profile first if needed." });
  const result = await db.transaction(async tx => {
    // Serialize with membership changes and invalidate revoked sessions even if the
    // shared session guard cannot reach the database. No fail-open consent writes.
    const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, session.userId!)).for("update");
    if (!user || user.suspendedAt || user.sessionVersion !== session.sv || (user.activeMembershipId ?? null) !== (session.activeMembershipId ?? null)) return { status: 409, message: "Your account changed. Sign in again before enrolling." };
    const consentedAt = new Date();
    const disclosure = (language === "es" ? PUBLIC_SMS_CONSENT_DISCLOSURE_ES : PUBLIC_SMS_CONSENT_DISCLOSURE) + (combined ? "\n\n" + (language === "es" ? WORK_PHONE_SMS_DISCLOSURE_ES : WORK_PHONE_SMS_DISCLOSURE) : "");
    const record = { phone, policyVersion: LEGAL_POLICY_VERSION, language, disclosure, consentedAt: consentedAt.toISOString(), source: language === "es" ? "https://vndrly.ai/es/sms/" : source, membershipId: recipient.membershipId, ...(combined ? {workPhone:true,workPhoneVersion:WORK_PHONE_SMS_VERSION} : {}) };
    const gatePatch = recipient.gate ? buildGateAlertConsentPatch(true, combined ? {...recipient,phone} : recipient, consentedAt) : {};
    const patch = { smsConsentRecord: record, ...gatePatch };
    await tx.insert(notificationPreferencesTable).values({ userId: session.userId!, ...patch }).onConflictDoUpdate({ target: notificationPreferencesTable.userId, set: patch });
    // Preserve earlier evidence when a user changes their number or enrolls again.
    // Audit readers do not receive raw mobile numbers.
    await tx.insert(workHubAuditLogTable).values({
      actorUserId: session.userId!, ownerOrgType: session.vendorId ? "vendor" : session.partnerId ? "partner" : "platform",
      ownerOrgId: session.vendorId ?? session.partnerId ?? 0, action: "sms_consent_granted", subjectType: "sms_consent", subjectId: String(session.userId), source: "public_sms_form",
      metadata: { ...record, phone: undefined, phoneHash: createHash("sha256").update(phone).digest("hex"), gateAlertsEnabled: recipient.gate },
    });
    if (combined) await tx.insert(workHubAuditLogTable).values({actorUserId:session.userId!,ownerOrgType:"platform",ownerOrgId:0,action:"personal_agreement_accepted",subjectType:"personal_agreement",subjectId:String(session.userId),source:"personal_settings",metadata:{document:"work_phone",version:WORK_PHONE_SMS_VERSION,acceptedAt:record.consentedAt,disclosure,phoneHash:createHash("sha256").update(phone).digest("hex")}});
    return { status: 200, saved: true, consentedAt: record.consentedAt, gateAlertsEnabled: recipient.gate, messageSent: false,
      message: "Your SMS consent is saved. Messages are limited to supported workflows and remain subject to campaign approval and any carrier STOP block. Reply START to the VNDRLY number to reverse a prior carrier STOP; this form cannot remove that block." };
  });
  const { status, ...payload } = result;
  return res.status(status).json(payload);
});
const agreementVersions = { eula: PLATFORM_EULA_VERSION, privacy: LEGAL_POLICY_VERSION, terms: LEGAL_POLICY_VERSION,
  work_phone: WORK_PHONE_SMS_VERSION,
  location_sharing: "2026-11-14",
  askv_microphone: "2026-11-14",
};
router.get("/personal-agreements", async (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session?.userId || session.role === "guest") return res.sendStatus(401);
  res.setHeader("Cache-Control", "no-store");
  const records = await db.select({ metadata: workHubAuditLogTable.metadata })
    .from(workHubAuditLogTable)
    .where(and(eq(workHubAuditLogTable.actorUserId, session.userId), eq(workHubAuditLogTable.subjectType, "personal_agreement")))
    .orderBy(desc(workHubAuditLogTable.createdAt), desc(workHubAuditLogTable.id));
  const seen = new Set<string>();
  const accepted = records.flatMap(({ metadata }) => {
    const record = metadata as { document: string; version: string; withdrawn?: boolean } | null;
    if (!record || seen.has(record.document)) return [];
    seen.add(record.document);
    return record.withdrawn ? [] : [record];
  });
  const [preferences] = await db.select({ consent: notificationPreferencesTable.smsConsentRecord })
    .from(notificationPreferencesTable).where(eq(notificationPreferencesTable.userId, session.userId));
  const consent=preferences?.consent as {phone?:string;workPhone?:boolean;consentedAt?:string}|null;
  const [account] = await db.select({ createdAt: usersTable.createdAt }).from(usersTable).where(eq(usersTable.id, session.userId));
  // Agreements are available to all signed-in users from their published version
  // date, or account creation for users who joined later. No browser-local clock.
  const availableAt = Object.fromEntries(Object.entries(agreementVersions).map(([document, version]) => {
    const published = Date.parse(`${version}T00:00:00Z`);
    const created = account?.createdAt ? new Date(account.createdAt).getTime() : published;
    return [document, new Date(Math.max(published, created)).toISOString()];
  }));
  return res.json({ versions: agreementVersions, availableAt, accepted, smsEnrolled: Boolean(consent), smsPhone:consent?.phone??null, workPhoneEnrolled:consent?.workPhone===true, smsConsentedAt:consent?.consentedAt??null });
});
router.post("/personal-agreements", async (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session?.userId || session.role === "guest") return res.sendStatus(401);
  const { document, version } = req.body ?? {};
  if (typeof document !== "string" || !Object.hasOwn(agreementVersions, document) ||
      version !== agreementVersions[document as keyof typeof agreementVersions]) return res.sendStatus(400);
  const withdrawn = req.body?.accepted === false;
  if(document === "work_phone") return res.status(409).json({message:"Use SMS Enrollment to save or unsubscribe from SMS and Work Phone together."});
  if(withdrawn) return res.status(409).json({message:"Recorded agreement acceptance cannot be changed. Device permissions remain available in device settings."});
  const acceptance = { document, version, acceptedAt: withdrawn ? undefined : new Date().toISOString(), ...(withdrawn ? { withdrawn, withdrawnAt: new Date().toISOString() } : {}) };
  await db.insert(workHubAuditLogTable).values({
    actorUserId: session.userId, ownerOrgType: "platform", ownerOrgId: 0,
    action: withdrawn ? "personal_agreement_withdrawn" : "personal_agreement_accepted", subjectType: "personal_agreement",
    subjectId: String(session.userId), source: "personal_settings", metadata: acceptance,
  });
  return res.json(acceptance);
});
export default router;
