import { LEGAL_EFFECTIVE_DATE, LEGAL_CONTACT_EMAIL, LEGAL_POLICY_VERSION, PRIVACY_POLICY_SECTIONS, TERMS_SECTIONS } from "./legal-docs";
import { PUBLIC_SMS_CONSENT_DISCLOSURE, PUBLIC_SMS_CONSENT_DISCLOSURE_ES } from "@workspace/api-zod/legal-policy";

import { PRIVACY_POLICY_SECTIONS_ES, TERMS_SECTIONS_ES } from "./legal-docs-es";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

/** Render the same policy source for readers that cannot execute the web app. */
export function renderPublicPrivacyHtml(language: "en" | "es" = "en"): string {
  return renderDocument("Privacy Policy", "privacy", renderSections(language === "es" ? PRIVACY_POLICY_SECTIONS_ES : PRIVACY_POLICY_SECTIONS), "/legal/privacy/", language);
}

/** Public carrier-review documents must remain readable without JavaScript. */
export function renderPublicTermsHtml(language: "en" | "es" = "en"): string {
  return renderDocument("Terms & Conditions", "terms", renderSections(language === "es" ? TERMS_SECTIONS_ES : TERMS_SECTIONS), "/legal/terms/", language);
}

export function renderPublicMessagingHtml(language: "en" | "es" = "en"): string {
  const form = `<section aria-label="SMS enrollment"><h2>Choose optional VNDRLY text updates</h2><p>Enroll in VNDRLY operational SMS updates using this form. Read the disclosure below, enter your mobile number and actively select the checkbox to opt in. <a href="/login">Sign in to your VNDRLY account</a> before saving, then return here. Creating or using an account does not require SMS.</p><form id="sms-consent-form" action="/api/notifications/sms-consent" method="post"><input type="hidden" name="language" value="${language}"><input type="hidden" name="policyVersion" value="${escapeHtml(LEGAL_POLICY_VERSION)}"><p><label for="sms-phone">Your mobile number (include + country code)</label><br><input id="sms-phone" name="phone" type="tel" autocomplete="tel" placeholder="+14055551234" maxlength="24" required></p><p><label><input type="checkbox" name="consent" value="yes" required> ${escapeHtml(language === "es" ? PUBLIC_SMS_CONSENT_DISCLOSURE_ES : PUBLIC_SMS_CONSENT_DISCLOSURE)}</label></p><p><a href="/legal/privacy/">Privacy Policy</a> · <a href="/legal/terms/">Terms & Conditions</a></p><p><button type="submit">Save my SMS consent</button></p><p id="sms-result" role="status" aria-live="polite"></p></form><p>Gate workers must use the number saved on their current employee profile. We record your account, number, consent wording, policy version and time. Consent does not grant additional account permissions or guarantee that a particular workflow supports SMS. This form sends no text. A prior carrier STOP block remains in effect; reply START to the VNDRLY number to reverse it.</p><p><strong>STOP:</strong> reply STOP to cancel. <strong>HELP:</strong> reply HELP or email <a href="mailto:support@vndrly.ai">support@vndrly.ai</a>.</p></section><script src="/sms-consent.js" defer></script>`;
  return renderDocument("SMS Enrollment", "messaging", `${form}${renderSections((language === "es" ? PRIVACY_POLICY_SECTIONS_ES : PRIVACY_POLICY_SECTIONS).slice(5, 6))}${renderSections((language === "es" ? TERMS_SECTIONS_ES : TERMS_SECTIONS).slice(4, 5))}`, "/sms/", language);
}

function renderSections(sections: { title: string; body: string[] }[]): string {
  return sections.map(section => `<section><h2>${escapeHtml(section.title)}</h2>${section.body.map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join("")}</section>`).join("\n");
}

// Only fixed interface text is translated here; legal paragraphs have their own
// complete Spanish source, and the server retains the selected disclosure.
function translatePublicHtml(html: string): string {
  const phrases: [string, string][] = [
    ["Choose optional VNDRLY text updates", "Elija actualizaciones opcionales por SMS de VNDRLY"],
    ["Enroll in VNDRLY operational SMS updates using this form. Read the disclosure below, enter your mobile number and actively select the checkbox to opt in.", "Inscríbase a las actualizaciones operativas por SMS de VNDRLY mediante este formulario. Lea el aviso, ingrese su número móvil y marque voluntariamente la casilla para inscribirse."],
    ["Sign in to your VNDRLY account", "Inicie sesión en su cuenta VNDRLY"],
    ["before saving, then return here. Creating or using an account does not require SMS.", "antes de guardar y luego regrese aquí. Crear o utilizar una cuenta no requiere SMS."],
    ["Your mobile number (include + country code)", "Su número móvil (incluya + y el código de país)"],
    ["Save my SMS consent", "Guardar mi consentimiento SMS"],
    ["Gate workers must use the number saved on their current employee profile. We record your account, number, consent wording, policy version and time. Consent does not grant additional account permissions or guarantee that a particular workflow supports SMS. This form sends no text. A prior carrier STOP block remains in effect; reply START to the VNDRLY number to reverse it.", "El personal de acceso debe utilizar el número guardado en su perfil de empleado actual. Registramos su cuenta, número, texto del consentimiento, versión de la política y fecha y hora. El consentimiento no otorga permisos adicionales ni garantiza que un proceso admita SMS. Este formulario no envía mensajes. Un bloqueo STOP previo del operador sigue vigente; responda START al número de VNDRLY para revertirlo."],
    ["reply STOP to cancel.", "responda STOP para cancelar."],
    ["reply HELP or email", "responda HELP o escriba a"],
    ["Back to sign in", "Volver al inicio de sesión"],
    ["VNDRLY sign in", "Iniciar sesión en VNDRLY"],
    ["Privacy Policy", "Política de privacidad"],
    ["Terms &amp; Conditions", "Términos y condiciones"],
    ["Terms & Conditions", "Términos y condiciones"],
    ["SMS Enrollment", "Inscripción a SMS"],
    ["SMS enrollment", "Inscripción a SMS"],
    ["Effective August 24, 2026", "Vigente desde el 24 de agosto de 2026"],
    ['href="/legal/', 'href="/es/legal/'],
    ['href="/sms/"', 'href="/es/sms/"'],
  ];
  // Preserve EN's explicit navigation target while localizing document links.
  const languageNav = html.match(/<nav class="language".*?<\/nav>/)?.[0] ?? "";
  let result = html.replace(languageNav, "<!--language-navigation-->");
  for (const [english, spanish] of phrases) result = result.split(english).join(spanish);
  return result.replace("<!--language-navigation-->", languageNav);
}

function renderDocument(title: string, slug: string, body: string, canonicalPath = `/legal/${slug}/`, language: "en" | "es" = "en"): string {
  const prefix = language === "es" ? "/es" : "";
  const page = `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VNDRLY ${escapeHtml(title)}</title><link rel="canonical" href="https://vndrly.ai${escapeHtml(prefix + canonicalPath)}"><style>
*{box-sizing:border-box}html{color-scheme:dark}body{--brand-primary:#f59e0b;font:14px/1.65 system-ui,sans-serif;background:#3a3d42;color:#f3f4f6;margin:0;padding:48px 24px}.document{max-width:768px;margin:auto}header{display:flex;align-items:center;gap:12px;margin-bottom:24px}header img{width:48px;height:48px;border-radius:8px;flex-shrink:0}h1{font-size:24px;line-height:1.25;margin:0;color:#fff}header p{font-size:14px;color:#d1d5db;margin:6px 0 0}h2{font-size:18px;line-height:1.4;margin-top:0;color:#fff}a{color:#fbbf24;text-underline-offset:3px}a:hover{color:#fcd34d}nav{margin:0 0 20px}main{border:2px solid #f59e0b;border-radius:12px;padding:24px;background:rgba(255,255,255,.05);box-shadow:0 1px 2px #0001}section+section{border-top:1px solid #ffffff26;margin-top:24px;padding-top:24px}p{margin:0 0 16px}input[type=tel]{display:block;width:100%;max-width:320px;border:1px solid #ffffff40;border-radius:6px;padding:10px 12px;margin-top:6px;background:#ffffff0d;color:#f3f4f6;font:inherit}input[type=checkbox]{accent-color:#f59e0b;margin:0 8px 0 0;width:16px;height:16px;vertical-align:middle}button{font:600 14px system-ui,sans-serif;color:#fbbf24;background:transparent;border:0;padding:8px 0;text-decoration:underline;text-underline-offset:3px;cursor:pointer}button:disabled{opacity:.6;cursor:wait}:focus-visible{outline:2px solid #fbbf24;outline-offset:4px}.back{display:inline-flex;align-items:center;gap:8px;text-decoration:none;font-weight:600;margin-bottom:20px}.back-icon{width:32px;height:32px;position:relative;display:inline-block;flex-shrink:0}.back-icon:before{content:"";position:absolute;inset:0;background:var(--brand-primary);-webkit-mask:url(/legal-assets/back-sphere.png) center/contain no-repeat;mask:url(/legal-assets/back-sphere.png) center/contain no-repeat}.back-icon img{position:absolute;inset:0;width:100%;height:100%}.back-icon .back-gloss{opacity:0;transition:opacity .2s}.back:hover .back-gloss{opacity:1}.back-icon .back-arrow{mix-blend-mode:screen}.language{display:flex;justify-content:flex-end;gap:0}.language a{border:1px solid #f59e0b;padding:3px 14px;text-decoration:none;font-weight:700}.language a:first-child{border-radius:999px 0 0 999px}.language a:last-child{border-radius:0 999px 999px 0}.language a[aria-current]{background:#f59e0b;color:#171717}footer{border-top:1px solid #ffffff33;margin-top:24px;padding-top:16px;color:#9ca3af;font-size:12px}@media(max-width:480px){body{padding:40px 16px}main{padding:20px}h1{font-size:22px}}
</style></head><body><div class="document"><nav class="language" aria-label="Language"><a href="${canonicalPath}" lang="en" ${language === "en" ? 'aria-current="page"' : ""}>EN</a><a href="/es${canonicalPath}" lang="es" ${language === "es" ? 'aria-current="page"' : ""}>ES</a></nav><a class="back" href="/login"><span class="back-icon" aria-hidden="true"><img class="back-gloss" src="/legal-assets/back-gloss.png" alt=""><img class="back-arrow" src="/legal-assets/back-arrow.png" alt=""></span>Back to sign in</a><header><a href="/login" aria-label="VNDRLY sign in"><img src="/favicon.png" alt="VNDRLY logo" width="48" height="48"></a><div><h1>VNDRLY ${escapeHtml(title)}</h1><p>Effective ${escapeHtml(LEGAL_EFFECTIVE_DATE)}</p></div></header><nav><a href="/legal/privacy/">Privacy Policy</a> · <a href="/legal/terms/">Terms & Conditions</a> · <a href="/sms/">SMS Enrollment</a></nav><main>${body}</main><footer><p><a class="back" href="/login"><span class="back-icon" aria-hidden="true"><img class="back-gloss" src="/legal-assets/back-gloss.png" alt=""><img class="back-arrow" src="/legal-assets/back-arrow.png" alt=""></span>Back to sign in</a> · <a href="mailto:${escapeHtml(LEGAL_CONTACT_EMAIL)}">${escapeHtml(LEGAL_CONTACT_EMAIL)}</a></p></footer></div></body></html>`;
  return language === "es" ? translatePublicHtml(page) : page;
}
