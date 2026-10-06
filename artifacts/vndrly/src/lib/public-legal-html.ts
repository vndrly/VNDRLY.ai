import { LEGAL_EFFECTIVE_DATE, LEGAL_CONTACT_EMAIL, PRIVACY_POLICY_SECTIONS } from "./legal-docs";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

/** Render the same policy source for readers that cannot execute the web app. */
export function renderPublicPrivacyHtml(): string {
  const sections = PRIVACY_POLICY_SECTIONS.map((section) => `<section><h2>${escapeHtml(section.title)}</h2>${section.body.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}</section>`).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VNDRLY Privacy Policy</title><link rel="canonical" href="https://vndrly.ai/legal/privacy"><style>body{font:17px/1.6 system-ui,sans-serif;max-width:850px;margin:40px auto;padding:0 24px;color:#182b39}h1,h2{line-height:1.25}a{color:#075b88}</style></head><body><header><a href="/">VNDRLY.ai</a><h1>Privacy Policy</h1><p>Effective ${escapeHtml(LEGAL_EFFECTIVE_DATE)}</p></header><main>${sections}</main><footer><a href="mailto:${escapeHtml(LEGAL_CONTACT_EMAIL)}">${escapeHtml(LEGAL_CONTACT_EMAIL)}</a></footer></body></html>`;
}
