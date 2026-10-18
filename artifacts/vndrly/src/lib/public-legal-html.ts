import { LEGAL_EFFECTIVE_DATE, LEGAL_CONTACT_EMAIL, LEGAL_POLICY_VERSION, PRIVACY_POLICY_SECTIONS, TERMS_SECTIONS } from "./legal-docs";
import { PUBLIC_SMS_CONSENT_DISCLOSURE } from "@workspace/api-zod/legal-policy";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

/** Render the same policy source for readers that cannot execute the web app. */
export function renderPublicPrivacyHtml(): string {
  const sections = PRIVACY_POLICY_SECTIONS.map((section) => `<section><h2>${escapeHtml(section.title)}</h2>${section.body.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}</section>`).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VNDRLY Privacy Policy</title><link rel="canonical" href="https://vndrly.ai/legal/privacy"><style>body{font:17px/1.6 system-ui,sans-serif;max-width:850px;margin:40px auto;padding:0 24px;color:#182b39}h1,h2{line-height:1.25}a{color:#075b88}</style></head><body><header><a href="/">VNDRLY.ai</a><h1>Privacy Policy</h1><p>Effective ${escapeHtml(LEGAL_EFFECTIVE_DATE)}</p></header><main>${sections}</main><footer><a href="mailto:${escapeHtml(LEGAL_CONTACT_EMAIL)}">${escapeHtml(LEGAL_CONTACT_EMAIL)}</a></footer></body></html>`;
}

/** Public carrier-review documents must remain readable without JavaScript. */
export function renderPublicTermsHtml(): string {
  return renderDocument("Terms & Conditions", "terms", renderSections(TERMS_SECTIONS));
}

export function renderPublicMessagingHtml(): string {
  const form = `<section aria-label="SMS enrollment"><h2>Choose optional VNDRLY text updates</h2><p>Enroll in VNDRLY operational SMS updates using this form. Read the disclosure below, enter your mobile number and actively select the checkbox to opt in. <a href="/login">Sign in to your VNDRLY account</a> before saving, then return here. Creating or using an account does not require SMS.</p><form id="sms-consent-form" action="/api/notifications/sms-consent" method="post"><input type="hidden" name="policyVersion" value="${escapeHtml(LEGAL_POLICY_VERSION)}"><p><label for="sms-phone">Your mobile number (include + country code)</label><br><input id="sms-phone" name="phone" type="tel" autocomplete="tel" placeholder="+14055551234" maxlength="24" required></p><p><label><input type="checkbox" name="consent" value="yes" required> ${escapeHtml(PUBLIC_SMS_CONSENT_DISCLOSURE)}</label></p><p><a href="/legal/privacy/">Privacy Policy</a> · <a href="/legal/terms/">Terms & Conditions</a></p><p><button type="submit">Save my SMS consent</button></p><p id="sms-result" role="status" aria-live="polite"></p></form><p>Gate workers must use the number saved on their current employee profile. We record your account, number, consent wording, policy version and time. Consent does not grant additional account permissions or guarantee that a particular workflow supports SMS. This form sends no text. A prior carrier STOP block remains in effect; reply START to the VNDRLY number to reverse it.</p><p><strong>STOP:</strong> reply STOP to cancel. <strong>HELP:</strong> reply HELP or email <a href="mailto:support@vndrly.ai">support@vndrly.ai</a>.</p></section><script src="/sms-consent.js" defer></script>`;
  return renderDocument("SMS Enrollment", "messaging", `${form}${renderSections(PRIVACY_POLICY_SECTIONS.filter(section => section.title === "Text Messaging and Mobile Information"))}${renderSections(TERMS_SECTIONS.filter(section => section.title === "Messaging Terms"))}`, "/sms/");
}

function renderSections(sections: { title: string; body: string[] }[]): string {
  return sections.map(section => `<section><h2>${escapeHtml(section.title)}</h2>${section.body.map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join("")}</section>`).join("\n");
}

function renderDocument(title: string, slug: string, body: string, canonicalPath = `/legal/${slug}`): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VNDRLY ${escapeHtml(title)}</title><link rel="canonical" href="https://vndrly.ai${escapeHtml(canonicalPath)}"><style>body{font:17px/1.6 system-ui,sans-serif;max-width:850px;margin:40px auto;padding:0 24px;color:#182b39}h1,h2{line-height:1.25}a{color:#075b88}input{margin-right:8px}</style></head><body><header><a href="/">VNDRLY.ai</a><h1>${escapeHtml(title)}</h1><p>Effective ${escapeHtml(LEGAL_EFFECTIVE_DATE)}</p><nav><a href="/legal/privacy">Privacy Policy</a> · <a href="/legal/terms">Terms & Conditions</a> · <a href="/legal/messaging">Messaging Consent</a></nav></header><main>${body}</main><footer><a href="mailto:${escapeHtml(LEGAL_CONTACT_EMAIL)}">${escapeHtml(LEGAL_CONTACT_EMAIL)}</a></footer></body></html>`;
}
