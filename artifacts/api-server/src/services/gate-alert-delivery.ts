import { createHash } from "node:crypto";
import { isE164Phone } from "../lib/twilio";
import { buildCommunicationsHealth } from "../lib/communications-health";
import { resolveGateNotificationCategory } from "../lib/gate-notification-policy";
import { logger } from "../lib/logger";

export type GateAlertChannel = "push" | "email" | "sms";
export type GateAlert = { id: number; userId: number; type: string; title: string; body?: string | null; link: string | null; badge?: number };
export type GateAlertRecipient = {
  userId: number; gate: boolean; membershipId: number | null; vendorPeopleId: number | null;
  phone: string | null; email: string | null;
  pushEnabled: boolean; gateAlertsEnabled: boolean; alertsEmailEnabled: boolean; alertsSmsEnabled: boolean;
  alertsSmsOptedInAt: Date | null; alertsSmsConsentFingerprint: string | null;
};
export type GateAlertOutcome = {
  notificationId: number; channel: GateAlertChannel; attemptToken: string;
  status: "accepted" | "skipped" | "retryable" | "failed" | "unknown";
  errorCode: string | null; providerMessageId?: string;
};
export type SendResult = { accepted: boolean; status?: GateAlertOutcome["status"]; providerMessageId?: string; errorCode?: string; permanent?: boolean };
export interface GateAlertDependencies {
  loadRecipient(userId: number): Promise<GateAlertRecipient | null>;
  authorized(notice: GateAlert, recipient: GateAlertRecipient): Promise<boolean>;
  readiness(): { email: boolean; sms: boolean };
  claim(notice: GateAlert, channel: GateAlertChannel, consentFingerprint: string | null, consentOptedInAt?: Date | null): Promise<{ attemptToken: string; attemptCount: number } | null>;
  finish(outcome: GateAlertOutcome): Promise<void>;
  push(notice: GateAlert, recipient: GateAlertRecipient): Promise<SendResult>;
  email(notice: GateAlert, recipient: GateAlertRecipient): Promise<SendResult>;
  sms(input: { to: string; body: string; attemptToken: string }): Promise<SendResult>;
  revokeSms(userId: number, fingerprint: string | null, consentOptedInAt: Date | null): Promise<void>;
}

/** Bind consent to this login, active organization and saved destination. Never store the phone in the delivery log. */
export function smsConsentFingerprint(userId: number, membershipId: number, personId: number, phone: string): string {
  return createHash("sha256").update(JSON.stringify([userId, membershipId, personId, phone])).digest("hex");
}
export function currentSmsFingerprint(recipient: GateAlertRecipient): string | null {
  return recipient.gate && recipient.membershipId && recipient.vendorPeopleId && recipient.phone && isE164Phone(recipient.phone)
    ? smsConsentFingerprint(recipient.userId, recipient.membershipId, recipient.vendorPeopleId, recipient.phone) : null;
}
export function buildGateAlertConsentPatch(enabled: boolean, recipient: GateAlertRecipient | null, at = new Date()) {
  const fingerprint = recipient && currentSmsFingerprint(recipient);
  if (enabled && !fingerprint) throw new Error("notifications.sms_phone_required");
  const previous = recipient?.alertsSmsEnabled && recipient.alertsSmsConsentFingerprint === fingerprint ? recipient.alertsSmsOptedInAt : null;
  return { alertsSmsEnabled: enabled, alertsSmsOptedInAt: enabled ? previous ?? at : null, alertsSmsConsentFingerprint: enabled ? fingerprint : null };
}
export function gateAlertReadiness(env: Record<string, string | undefined> = process.env) {
  const health = buildCommunicationsHealth(env);
  let validCallback = false;
  try {
    const url = new URL(env.TWILIO_STATUS_CALLBACK_URL ?? "");
    validCallback = url.protocol === "https:" && url.pathname === "/api/twilio/gate-alert-status" && !url.search && !url.hash && !url.username && !url.password;
  } catch { /* unconfigured */ }
  return {
    email: env.GATE_ALERT_EMAIL_ENABLED === "true" && health.services.sendgrid.configured,
    // Advanced Opt-Out owns STOP/START/HELP responses and provider suppression.
    sms: health.features.transactionalSms.ready && Boolean(env.TWILIO_AUTH_TOKEN?.trim()) && validCallback &&
      Boolean(env.TWILIO_MESSAGING_SERVICE_SID?.trim()) && env.TWILIO_ADVANCED_OPT_OUT_ENABLED === "true",
  };
}

/** A notification already exists before this runs. Each channel claims and persists independently. */
export async function deliverGateAlert(notice: GateAlert, dependencies?: GateAlertDependencies, resolvedRecipient?: GateAlertRecipient | null): Promise<boolean> {
  if (resolveGateNotificationCategory(notice) !== "alerts") return true;
  const deps = dependencies ?? (await import("./gate-alert-repository")).gateAlertDependencies;
  const recipient = resolvedRecipient === undefined ? await deps.loadRecipient(notice.userId) : resolvedRecipient;
  if (!recipient?.gate || !recipient.gateAlertsEnabled || !(await deps.authorized(notice, recipient))) return true;
  const ready = deps.readiness();
  const fingerprint = currentSmsFingerprint(recipient);
  const smsConsent = recipient.alertsSmsEnabled && recipient.alertsSmsOptedInAt && fingerprint && fingerprint === recipient.alertsSmsConsentFingerprint;
  const skip: Record<GateAlertChannel, string | null> = {
    push: recipient.pushEnabled ? null : "disabled",
    email: !recipient.alertsEmailEnabled ? "disabled" : !recipient.email ? "missing_email" : !ready.email ? "not_configured" : null,
    sms: !smsConsent ? "consent_required" : !ready.sms ? "not_configured" : null,
  };
  const channels = ["push", "email", "sms"] as const;
  const results = await Promise.allSettled(channels.map(async channel => {
    const claim = await deps.claim(notice, channel, channel === "sms" ? fingerprint : null, channel === "sms" ? recipient.alertsSmsOptedInAt : null);
    if (!claim) return;
    const outcome: GateAlertOutcome = { notificationId: notice.id, channel, attemptToken: claim.attemptToken, status: "skipped", errorCode: skip[channel] };
    if (!skip[channel]) {
      try {
        const result = channel === "push" ? await deps.push(notice, recipient) : channel === "email" ? await deps.email(notice, recipient) : await deps.sms({
          to: recipient.phone!, attemptToken: claim.attemptToken,
          body: "VNDRLY urgent alert. Open the app to review. Reply STOP to opt out or HELP for help.",
        });
        outcome.status = result.status ?? (result.accepted ? "accepted" : result.permanent ? "failed" : "retryable");
        outcome.providerMessageId = result.providerMessageId;
        outcome.errorCode = result.errorCode && /^\d{3,6}$/.test(result.errorCode) ? result.errorCode : result.accepted ? null : "not_accepted";
        if (channel === "sms" && result.permanent) await deps.revokeSms(recipient.userId, fingerprint, recipient.alertsSmsOptedInAt);
      } catch {
        // A timeout may happen after provider acceptance. SMS/email must not be blindly resent.
        outcome.status = "unknown";
        outcome.errorCode = "provider_exception";
      }
    }
    await deps.finish(outcome);
  }));
  results.forEach((result, index) => {
    if (result.status === "rejected") logger.warn({ notificationId: notice.id, channel: channels[index] }, "Gate alert channel audit unavailable");
  });
  return results.every(result => result.status === "fulfilled");
}
