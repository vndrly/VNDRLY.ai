import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { sendTransactionalSms, TwilioSmsError } from "../lib/twilio";
import { isPermanentSmsError, shouldApplyTwilioStatus, type TwilioStatusUpdate } from "../routes/twilioStatus";
import { deliverGateAlert, gateAlertReadiness, type GateAlert, type GateAlertDependencies, type GateAlertRecipient } from "./gate-alert-delivery";
import type { SessionPayload } from "../lib/session";
import { logger } from "../lib/logger";

type Recipient = GateAlertRecipient & { session: SessionPayload & { userId: number } };
export async function loadGateAlertRecipient(userId: number): Promise<Recipient | null> {
  const { rows } = await pool.query(`SELECT u.id AS "userId", u.role AS "userRole", u.email, u.session_version AS "sessionVersion",
    m.id AS "membershipId", m.org_type AS "orgType", m.vendor_id AS "vendorId", m.partner_id AS "partnerId", m.role AS "membershipRole",
    vp.id AS "vendorPeopleId", vp.vendor_role AS "vendorRole", vp.phone,
    p.push_enabled AS "pushEnabled", p.gate_alerts_enabled AS "gateAlertsEnabled",
    p.alerts_email_enabled AS "alertsEmailEnabled", p.alerts_sms_enabled AS "alertsSmsEnabled",
    p.alerts_sms_opted_in_at AS "alertsSmsOptedInAt", p.alerts_sms_consent_fingerprint AS "alertsSmsConsentFingerprint",
    COALESCE((SELECT jsonb_agg(jsonb_build_object('siteId',g.site_id,'role',g.role))
      FROM managed_subcontractor_role_grants g
      JOIN managed_subcontractor_worker_sponsorships s ON s.id = g.sponsorship_id
      WHERE s.worker_user_id = u.id AND s.sponsor_vendor_id = m.vendor_id AND s.status = 'active' AND s.ended_at IS NULL
      AND g.status = 'active' AND g.ended_at IS NULL AND g.site_id IS NOT NULL
      AND g.role IN ('gatekeeper','gate_supervisor')), '[]'::jsonb) AS grants
    FROM users u
    LEFT JOIN user_org_memberships m ON m.id = u.active_membership_id AND m.user_id = u.id
    LEFT JOIN vendor_people vp ON vp.id = m.vendor_people_id AND vp.vendor_id = m.vendor_id
      AND vp.user_id = u.id AND vp.is_active = true AND vp.deleted_at IS NULL
    LEFT JOIN notification_preferences p ON p.user_id = u.id
    WHERE u.id = $1 AND u.suspended_at IS NULL`, [userId]);
  const row = rows[0];
  if (!row) return null;
  const validVendor = row.orgType === "vendor" && Number.isSafeInteger(row.vendorId) && row.vendorId > 0 && row.partnerId == null;
  const validPartner = row.orgType === "partner" && Number.isSafeInteger(row.partnerId) && row.partnerId > 0 && row.vendorId == null;
  const systemAdmin = row.userRole === "admin" && row.membershipId == null;
  if (!systemAdmin && (!row.membershipId || (!validVendor && !validPartner))) return null;
  const grants = row.grants ?? [];
  // Match login context: a vendor field membership without a linked active
  // employee is a restricted managed worker, even after all grants end.
  const managed = validVendor && row.membershipRole === "field_employee" && !row.vendorPeopleId;
  const gate = validVendor && (["gatekeeper", "gate_supervisor"].includes(row.vendorRole) || grants.length > 0);
  return {
    userId, gate, membershipId: row.membershipId ?? null, vendorPeopleId: row.vendorPeopleId ?? null,
    phone: row.phone ?? null, email: typeof row.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email) ? row.email : null,
    pushEnabled: row.pushEnabled ?? true, gateAlertsEnabled: row.gateAlertsEnabled ?? true,
    alertsEmailEnabled: row.alertsEmailEnabled ?? true, alertsSmsEnabled: row.alertsSmsEnabled ?? false,
    alertsSmsOptedInAt: row.alertsSmsOptedInAt ?? null, alertsSmsConsentFingerprint: row.alertsSmsConsentFingerprint ?? null,
    session: { userId, sv: row.sessionVersion, role: systemAdmin ? "admin" : row.membershipRole === "field_employee" ? "field_employee" : row.orgType, vendorId: row.vendorId,
      partnerId: row.partnerId, vendorPeopleId: row.vendorPeopleId, vendorRole: row.vendorRole,
      activeMembershipId: row.membershipId, membershipRole: row.membershipRole,
      ...(managed || grants.length ? { managedSubcontractor: { siteGrants: grants } } : {}) },
  };
}

const revokeSql = `UPDATE notification_preferences SET alerts_sms_enabled = false,
  alerts_sms_opted_in_at = NULL, alerts_sms_consent_fingerprint = NULL, updated_at = now()
  WHERE user_id = $1 AND alerts_sms_consent_fingerprint = $2 AND alerts_sms_opted_in_at = $3`;
export const gateAlertDependencies: GateAlertDependencies = {
  loadRecipient: loadGateAlertRecipient,
  authorized: async (notice, recipient) => {
    const session = (recipient as Recipient).session;
    if (!session) return false;
    const { resolveNotificationDestination } = await import("../lib/notification-destination");
    return Boolean(await resolveNotificationDestination(session, notice.link, "alerts"));
  },
  readiness: gateAlertReadiness,
  async cancelRetryable(notice, channels, reason) {
    if (!channels.length) return;
    // One statement terminalizes every selected retry, including those not due yet.
    // Never rewrite accepted/ambiguous/in-flight sends or invalidate their provider audit.
    await pool.query(`UPDATE notification_channel_deliveries AS d SET status = 'cancelled',
      last_error_code = $4, next_attempt_at = NULL, updated_at = now()
      FROM notifications n WHERE d.notification_id = n.id AND n.id = $1 AND n.user_id = $2
        AND d.channel = ANY($3::text[]) AND d.status = 'retryable'`, [notice.id, notice.userId, channels, reason]);
  },
  async claim(notice, channel, consentFingerprint, consentOptedInAt) {
    const { rows } = await pool.query(`INSERT INTO notification_channel_deliveries
      (notification_id,channel,attempt_token,consent_fingerprint,consent_opted_in_at)
      SELECT n.id,$3,$4,$5,$6 FROM notifications n WHERE n.id = $1 AND n.user_id = $2
      ON CONFLICT (notification_id, channel) DO UPDATE SET status = 'sending', attempt_token = EXCLUDED.attempt_token,
        attempt_count = notification_channel_deliveries.attempt_count + 1, updated_at = now(),
        consent_fingerprint = EXCLUDED.consent_fingerprint, consent_opted_in_at = EXCLUDED.consent_opted_in_at,
        last_error_code = NULL, next_attempt_at = NULL
      WHERE notification_channel_deliveries.status = 'retryable'
        AND notification_channel_deliveries.attempt_count < 3
        AND notification_channel_deliveries.next_attempt_at <= now()
      RETURNING attempt_token AS "attemptToken", attempt_count AS "attemptCount"`,
    [notice.id, notice.userId, channel, randomUUID(), consentFingerprint, consentOptedInAt ?? null]);
    return rows[0] ?? null;
  },
  async finish(result) {
    await pool.query(`UPDATE notification_channel_deliveries SET
      status = CASE WHEN $4 = 'retryable' AND attempt_count >= 3 THEN 'failed' ELSE $4 END,
      last_error_code = $5, provider_message_id = $6, updated_at = now(),
      next_attempt_at = CASE WHEN $4 = 'retryable' AND attempt_count < 3 THEN now() + interval '1 minute' * attempt_count ELSE NULL END
      WHERE notification_id = $1 AND channel = $2 AND attempt_token = $3 AND status = 'sending'`,
    [result.notificationId, result.channel, result.attemptToken, result.status, result.errorCode, result.providerMessageId ?? null]);
  },
  async push(notice, recipient) {
    const { sendGateAlertPush } = await import("./gate-alert-push");
    const { countGateUnreadNotifications } = await import("../routes/notifications");
    let badge: number;
    try { badge = await countGateUnreadNotifications((recipient as Recipient).session); }
    catch { return { accepted: false, status: "retryable", errorCode: "badge_unavailable" }; }
    return sendGateAlertPush(notice, badge);
  },
  async email(notice, recipient) {
    const { sendNotificationAlertEmail, SendGridMailError } = await import("../lib/sendgrid");
    try {
      const receipt = await sendNotificationAlertEmail({ to: recipient.email!, title: notice.title, body: notice.body,
        link: notice.link, category: "safety", type: notice.type, highPriority: true });
      return { accepted: true, providerMessageId: receipt.messageId };
    } catch (error) {
      if (!(error instanceof SendGridMailError) || !error.definitelyRejected) throw error;
      return { accepted: false, errorCode: String(error.status), permanent: ![429, 503].includes(error.status) };
    }
  },
  async sms(input) {
    try {
      const result = await sendTransactionalSms({ to: input.to, body: input.body,
        statusCallbackUrl: `${process.env.TWILIO_STATUS_CALLBACK_URL}?attempt=${input.attemptToken}` });
      if (!result.sid) throw new Error("sms_acceptance_unknown");
      const code = result.errorCode == null ? undefined : String(result.errorCode);
      return { accepted: Boolean(result.sid) && !["failed", "undelivered"].includes(result.status ?? ""),
        providerMessageId: result.sid, errorCode: code, permanent: isPermanentSmsError(code) };
    } catch (error) {
      if (!(error instanceof TwilioSmsError) || !error.definitelyRejected) throw error;
      return { accepted: false, errorCode: error.code ?? undefined, permanent: isPermanentSmsError(error.code) };
    }
  },
  async revokeSms(userId, fingerprint, consentAt) { await pool.query(revokeSql, [userId, fingerprint, consentAt]); },
};

/** Row lock plus monotonic states make provider retries/reordering harmless, including callbacks before send returns. */
export async function applyTwilioStatus(update: TwilioStatusUpdate): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(`SELECT d.id, d.status, d.provider_message_id AS "providerMessageId",
      d.consent_fingerprint AS "consentFingerprint", d.consent_opted_in_at AS "consentOptedInAt", n.user_id AS "userId"
      FROM notification_channel_deliveries d JOIN notifications n ON n.id = d.notification_id
      WHERE d.attempt_token = $1 AND d.channel = 'sms' FOR UPDATE OF d`, [update.attemptToken]);
    const row = rows[0];
    if (row && (!row.providerMessageId || row.providerMessageId === update.providerMessageId) && shouldApplyTwilioStatus(row.status, update.status)) {
      await client.query(`UPDATE notification_channel_deliveries SET status = $2, provider_message_id = $3,
        last_error_code = $4, updated_at = now(), next_attempt_at = NULL,
        delivered_at = CASE WHEN $2 = 'delivered' THEN now() ELSE delivered_at END WHERE id = $1`,
      [row.id, update.status, update.providerMessageId, update.errorCode]);
      if (update.permanent) await client.query(revokeSql, [row.userId, row.consentFingerprint, row.consentOptedInAt]);
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

/** Only definite failures marked retryable are replayed; a crashed/ambiguous send stays unknown/sending. */
export async function retryGateAlertChannels(): Promise<number> {
  try { await (await import("./gate-alert-push")).retryGateAlertPushCleanup(); }
  catch { logger.warn("Gate push cleanup unavailable"); }
  const { rows } = await pool.query(`SELECT DISTINCT n.id, n.user_id AS "userId", n.type, n.title, n.body, n.link
    FROM notifications n LEFT JOIN notification_channel_deliveries d ON d.notification_id = n.id
    WHERE (n.urgent_delivery_leased_until IS NULL OR n.urgent_delivery_leased_until <= now())
      AND (n.urgent_delivery_pending = true OR (d.status = 'retryable' AND d.attempt_count < 3 AND d.next_attempt_at <= now()))
    ORDER BY n.id LIMIT 100`);
  await Promise.allSettled(rows.map(row => processPendingGateAlert(row)));
  return rows.length;
}

/** Durable notification marker precedes recipient lookup; expiring CAS lease permits crash recovery. */
export async function processPendingGateAlert(notice: GateAlert): Promise<void> {
  const lease = randomUUID();
  const claim = await pool.query(`UPDATE notifications SET urgent_delivery_lease = $3,
    urgent_delivery_leased_until = now() + interval '5 minutes'
    WHERE id = $1 AND user_id = $2 AND (urgent_delivery_leased_until IS NULL OR urgent_delivery_leased_until <= now())
      AND (urgent_delivery_pending = true OR EXISTS (SELECT 1 FROM notification_channel_deliveries d
        WHERE d.notification_id = notifications.id AND d.status = 'retryable' AND d.attempt_count < 3 AND d.next_attempt_at <= now()))
    RETURNING id`, [notice.id, notice.userId, lease]);
  if (!claim.rows.length) return;
  const recipient = await loadGateAlertRecipient(notice.userId);
  const scheduled = recipient && !recipient.gate
    ? await (await import("../routes/notifications")).deliverUrgentOfficeNotification(notice)
    : await deliverGateAlert(notice, gateAlertDependencies, recipient);
  if (scheduled) await pool.query(`UPDATE notifications SET urgent_delivery_pending = false,
    urgent_delivery_lease = NULL, urgent_delivery_leased_until = NULL
    WHERE id = $1 AND urgent_delivery_lease = $2`, [notice.id, lease]);
}
