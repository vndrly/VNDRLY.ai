import { LEGAL_EFFECTIVE_DATE, LEGAL_CONTACT_EMAIL, LEGAL_POLICY_VERSION, MESSAGING_DISCLOSURE, PRIVACY_POLICY_SECTIONS, TERMS_SECTIONS } from "./legal-docs";

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
  const disclosure = MESSAGING_DISCLOSURE;
  const preview = `<section aria-label="Onboarding consent screen preview"><h2>Onboarding consent screen preview</h2><p>This read-only preview shows the consent wording used during partner and vendor onboarding. It does not enroll anyone or record consent. Both choices begin unchecked; SMS is optional.</p><h3>Privacy, terms, and messaging</h3><p>Review VNDRLY's Privacy Policy and Terms & Conditions before continuing. SMS updates are optional and can be changed later.</p><p><a href="/legal/privacy">Privacy Policy</a> · <a href="/legal/terms">Terms & Conditions</a> · Policy version ${escapeHtml(LEGAL_POLICY_VERSION)}</p><p><label><input type="checkbox" disabled> I have read and agree to the VNDRLY Terms & Conditions and acknowledge the VNDRLY Privacy Policy on behalf of my organization.</label></p><p><label><input type="checkbox" disabled> I agree to receive transactional and operational text messages from VNDRLY at the mobile number I provided. ${escapeHtml(disclosure.rates)} ${escapeHtml(disclosure.stop)} ${escapeHtml(disclosure.help)} ${escapeHtml(disclosure.carriers)} Consent is not required to create an account or use VNDRLY.</label></p></section>`;
  return renderDocument("Messaging Consent Disclosure", "messaging", `<section><h2>Public Opt-In Disclosure</h2><p>Users enter their mobile number during onboarding and actively select a separate, initially unchecked SMS consent checkbox. SMS is voluntary and separate from required legal acceptance. Enrollment takes place at <a href="/signup/partner">Partner signup</a> or <a href="/signup/vendor">Vendor signup</a>; this preview cannot enroll users.</p></section>${preview}${renderSections(PRIVACY_POLICY_SECTIONS.filter(section => section.title === "Text Messaging and Mobile Information"))}${renderSections(TERMS_SECTIONS.filter(section => section.title === "Messaging Terms"))}`);
}

function renderSections(sections: { title: string; body: string[] }[]): string {
  return sections.map(section => `<section><h2>${escapeHtml(section.title)}</h2>${section.body.map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join("")}</section>`).join("\n");
}

function renderDocument(title: string, slug: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VNDRLY ${escapeHtml(title)}</title><link rel="canonical" href="https://vndrly.ai/legal/${slug}"><style>body{font:17px/1.6 system-ui,sans-serif;max-width:850px;margin:40px auto;padding:0 24px;color:#182b39}h1,h2{line-height:1.25}a{color:#075b88}input{margin-right:8px}</style></head><body><header><a href="/">VNDRLY.ai</a><h1>${escapeHtml(title)}</h1><p>Effective ${escapeHtml(LEGAL_EFFECTIVE_DATE)}</p><nav><a href="/legal/privacy">Privacy Policy</a> · <a href="/legal/terms">Terms & Conditions</a> · <a href="/legal/messaging">Messaging Consent</a></nav></header><main>${body}</main><footer><a href="mailto:${escapeHtml(LEGAL_CONTACT_EMAIL)}">${escapeHtml(LEGAL_CONTACT_EMAIL)}</a></footer></body></html>`;
}
