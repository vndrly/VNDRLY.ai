#!/usr/bin/env node
import { pathToFileURL } from "node:url";

export const STAFFING_INBOUND_URL = "https://vndrly.ai/api/twilio/staffing-alert-reply";
const SID = { account: /^AC[0-9a-f]{32}$/i, key: /^SK[0-9a-f]{32}$/i, service: /^MG[0-9a-f]{32}$/i, phone: /^PN[0-9a-f]{32}$/i };
const routing = value => !value ? "empty" : value === STAFFING_INBOUND_URL ? "ours" : "other";

/** No sends, credential changes, phone-number edits, opt-out edits or database access. */
export async function inspectStaffingInbound(env = process.env, { configure = false, fetchImpl = fetch } = {}) {
  const result = { mode: configure ? "configure" : "inspect", readyToEnable: false, configured: false, blockers: [], checks: { advancedOptOut: "not_exposed_by_service_api", advancedOptOutAttestation: env.TWILIO_ADVANCED_OPT_OUT_ENABLED === "true", authTokenPresent: Boolean(env.TWILIO_AUTH_TOKEN?.trim()), authTokenVerified: false, senderCount: 0 } };
  const block = reason => { if (!result.blockers.includes(reason)) result.blockers.push(reason); };
  const account = env.TWILIO_ACCOUNT_SID?.trim(), key = env.TWILIO_API_KEY?.trim(), secret = env.TWILIO_API_SECRET?.trim(), serviceId = env.TWILIO_MESSAGING_SERVICE_SID?.trim(), token = env.TWILIO_AUTH_TOKEN?.trim();
  if (!SID.account.test(account ?? "") || !SID.key.test(key ?? "") || !secret || !SID.service.test(serviceId ?? "")) { block("missing_or_invalid_rest_credentials"); return result; }
  if (!token) block("missing_webhook_auth_token");
  if (!result.checks.advancedOptOutAttestation) block("advanced_opt_out_not_attested");
  if (env.TWILIO_STAFFING_REPLY_ENABLED?.trim() && env.TWILIO_STAFFING_REPLY_ENABLED !== "true") block("explicit_reply_disable_preserved");
  if (env.TWILIO_STAFFING_INBOUND_URL?.trim() && env.TWILIO_STAFFING_INBOUND_URL.trim() !== STAFFING_INBOUND_URL) block("environment_inbound_url_conflict");
  const auth = `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`;
  const serviceUrl = `https://messaging.twilio.com/v1/Services/${serviceId}`;
  async function request(url, authorization = auth, body) {
    try {
      const response = await fetchImpl(url, { method: body ? "POST" : "GET", headers: { Authorization: authorization, ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) }, ...(body ? { body } : {}), redirect: "error", signal: AbortSignal.timeout(15000) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) { block(`provider_http_${response.status}${/^\d{3,6}$/.test(String(payload.code)) ? `_code_${payload.code}` : ""}`); return null; }
      return payload;
    } catch { block("provider_request_failed"); return null; }
  }
  const service = await request(serviceUrl);
  if (!service) return result;
  if (service.sid !== serviceId || service.account_sid !== account) { block("service_account_mismatch"); return result; }
  result.checks.serviceAccountMatched = true;
  result.checks.serviceInbound = routing(service.inbound_request_url);
  if (routing(service.inbound_request_url) === "other") block("existing_service_inbound_preserved");
  if (routing(service.fallback_url) === "other") block("existing_service_fallback_preserved");
  if (token) {
    // Read-only token verification: only SID/status are used. Any returned
    // credential fields are discarded, never extracted, persisted or printed.
    const identity = await request(`https://api.twilio.com/2010-04-01/Accounts/${account}.json`, `Basic ${Buffer.from(`${account}:${token}`).toString("base64")}`);
    result.checks.authTokenVerified = Boolean(identity?.sid === account && identity?.status === "active");
    if (!result.checks.authTokenVerified) block("webhook_auth_token_not_verified");
  }
  async function collection(path, name) {
    let url = `${serviceUrl}/${path}?PageSize=100`;
    const rows = [], seen = new Set();
    while (url) {
      if (seen.has(url) || seen.size >= 10 || !url.startsWith(`${serviceUrl}/${path}?`)) { block("sender_inventory_incomplete"); return rows; }
      seen.add(url);
      const page = await request(url);
      if (!page || !Array.isArray(page[name])) { block("sender_inventory_incomplete"); return rows; }
      rows.push(...page[name]);
      url = page.meta?.next_page_url ?? null;
    }
    return rows;
  }
  const phones = await collection("PhoneNumbers", "phone_numbers"), shortCodes = await collection("ShortCodes", "short_codes");
  if (shortCodes.length) block("short_code_routing_requires_separate_review");
  result.checks.senderCount = phones.length;
  if (!phones.length) block("no_phone_sender_verified");
  for (const sender of phones) {
    if (!SID.phone.test(sender.sid ?? "") || sender.account_sid !== account) { block("sender_account_mismatch"); continue; }
    const number = await request(`https://api.twilio.com/2010-04-01/Accounts/${account}/IncomingPhoneNumbers/${sender.sid}.json`);
    if (!number || number.sid !== sender.sid || number.account_sid !== account || number.capabilities?.sms !== true) { block("sms_sender_not_verified"); continue; }
    if (routing(number.sms_url) === "other" || routing(number.sms_fallback_url) === "other" || number.sms_application_sid) block("existing_number_inbound_preserved");
  }
  if (result.blockers.length) return result;
  const matches = value => value?.inbound_request_url === STAFFING_INBOUND_URL && value?.inbound_method === "POST" && value?.use_inbound_webhook_on_number === false;
  if (!matches(service)) {
    if (!configure) { block("inbound_not_configured"); return result; }
    const current = await request(serviceUrl);
    if (!current) return result;
    if (current.sid !== serviceId || current.account_sid !== account || ["inbound_request_url", "inbound_method", "use_inbound_webhook_on_number", "fallback_url", "fallback_method"].some(field => (current[field] ?? null) !== (service[field] ?? null))) { block("provider_settings_changed_during_inspection"); return result; }
    const updated = await request(serviceUrl, auth, new URLSearchParams({ InboundRequestUrl: STAFFING_INBOUND_URL, InboundMethod: "POST", UseInboundWebhookOnNumber: "false" }));
    if (!updated) return result;
    const verified = await request(serviceUrl);
    if (!matches(verified) || verified.account_sid !== account || verified.sid !== serviceId) { block("inbound_readback_failed"); return result; }
    if (["status_callback", "fallback_url", "fallback_method"].some(field => (verified[field] ?? null) !== (service[field] ?? null))) { block("unrelated_service_settings_changed"); return result; }
    result.configured = true;
  }
  result.readyToEnable = true;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--configure") || args.length > 1) {
    process.stderr.write("Usage: node --env-file=.env.production scripts/provision-twilio-staffing-inbound.mjs [--configure]\n");
    process.exitCode = 1;
  } else {
    const result = await inspectStaffingInbound(process.env, { configure: args.includes("--configure") });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.readyToEnable ? 0 : 2;
  }
}
