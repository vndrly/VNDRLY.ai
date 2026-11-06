import { LEGAL_EFFECTIVE_DATE, LEGAL_CONTACT_EMAIL, LEGAL_POLICY_VERSION, PRIVACY_POLICY_SECTIONS, TERMS_SECTIONS, SMS_ENROLLMENT_POLICY_PATH } from "./legal-docs";
import { PUBLIC_SMS_CONSENT_DISCLOSURE, PUBLIC_SMS_CONSENT_DISCLOSURE_ES } from "@workspace/api-zod/legal-policy";

import { PRIVACY_POLICY_SECTIONS_ES, TERMS_SECTIONS_ES } from "./legal-docs-es";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

/** Render the same policy source for readers that cannot execute the web app. */
export function renderPublicPrivacyHtml(language: "en" | "es" = "en", logoUrl = "/favicon.png"): string {
  return renderDocument("Privacy Policy", "privacy", renderSections(language === "es" ? PRIVACY_POLICY_SECTIONS_ES : PRIVACY_POLICY_SECTIONS), "/legal/privacy/", language, logoUrl);
}

/** Public carrier-review documents must remain readable without JavaScript. */
export function renderPublicTermsHtml(language: "en" | "es" = "en", logoUrl = "/favicon.png"): string {
  return renderDocument("Terms & Conditions", "terms", renderSections(language === "es" ? TERMS_SECTIONS_ES : TERMS_SECTIONS), "/legal/terms/", language, logoUrl);
}

export function renderPublicMessagingHtml(language: "en" | "es" = "en", logoUrl = "/favicon.png"): string {
  const form = `<section aria-label="SMS enrollment"><h2>Choose optional VNDRLY text updates</h2><p>Enroll in VNDRLY operational SMS updates using this form. Read the disclosure below, enter your mobile number and actively select the checkbox to opt in. <a href="/login">Sign in to your VNDRLY account</a> before saving, then return here. Creating or using an account does not require SMS.</p><form id="sms-consent-form" action="/api/notifications/sms-consent" method="post"><input type="hidden" name="language" value="${language}"><input type="hidden" name="policyVersion" value="${escapeHtml(LEGAL_POLICY_VERSION)}"><p><label for="sms-phone">Your mobile number (include + country code)</label><br><input id="sms-phone" name="phone" type="tel" autocomplete="tel" placeholder="+14055551234" maxlength="24" required></p><p><label class="consent-choice"><input type="checkbox" name="consent" value="yes" required> ${escapeHtml(language === "es" ? PUBLIC_SMS_CONSENT_DISCLOSURE_ES : PUBLIC_SMS_CONSENT_DISCLOSURE)}</label></p><p><a href="/legal/privacy/">Privacy Policy</a> · <a href="/legal/terms/">Terms & Conditions</a></p><p><button type="submit">Save my SMS consent</button></p><p id="sms-result" role="status" aria-live="polite"></p></form><p>Gate workers must use the number saved on their current employee profile. We record your account, number, consent wording, policy version and time. Consent does not grant additional account permissions or guarantee that a particular workflow supports SMS. This form sends no text. A prior carrier STOP block remains in effect; reply START to the VNDRLY number to reverse it.</p><p><strong>STOP:</strong> reply STOP to cancel. <strong>HELP:</strong> reply HELP or email <a href="mailto:support@vndrly.ai">support@vndrly.ai</a>.</p></section><script src="/sms-consent.js" defer></script>`;
  return renderDocument("SMS Enrollment", "messaging", `${form}${renderSmsPolicySections(language)}`, "/sms/", language, logoUrl);
}

function renderSmsPolicySections(language: "en" | "es"): string {
  const privacy = language === "es" ? PRIVACY_POLICY_SECTIONS_ES : PRIVACY_POLICY_SECTIONS;
  const terms = language === "es" ? TERMS_SECTIONS_ES : TERMS_SECTIONS;
  return renderSections([...privacy.slice(5, 6), ...terms.slice(4, 5)]);
}

export function renderPublicSmsPolicyHtml(language: "en" | "es" = "en", logoUrl = "/favicon.png"): string {
  const title = language === "es" ? "Política de inscripción por SMS" : "SMS Enrollment Policy";
  return renderDocument(title, "messaging-policy", renderSmsPolicySections(language), SMS_ENROLLMENT_POLICY_PATH, language, logoUrl);
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

function renderDocument(title: string, slug: string, body: string, canonicalPath = `/legal/${slug}/`, language: "en" | "es" = "en", logoUrl = "/favicon.png"): string {
  const prefix = language === "es" ? "/es" : "";
  const englishLink = `<a href="${canonicalPath}" lang="en" ${language === "en" ? 'aria-current="page"' : ""}>English</a>`;
  const spanishLink = `<a href="/es${canonicalPath}" lang="es" ${language === "es" ? 'aria-current="page"' : ""}>Español</a>`;
  const slider =
    `<a class="language-slider" href="${language === "en" ? "/es" : ""}${canonicalPath}" aria-label="${language === "en" ? "Cambiar a Español" : "Switch to English"}"><span aria-hidden="true"></span></a>`;
  const page = `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VNDRLY ${escapeHtml(title)}</title><link rel="canonical" href="https://vndrly.ai${escapeHtml(prefix + canonicalPath)}"><style>
.public-legal {
  --legal-primary: var(--brand-primary, #e6ac00);
  --legal-accent: var(--legal-primary);
  min-height: 100vh;
  padding: 56px 24px 48px;
  color-scheme: dark;
  background: #3a3d42;
  color: #f3f4f6;
  font: 14px/1.65 system-ui, sans-serif;
  background: linear-gradient(135deg, #22252af5, #3a3d42dc 52%, #111827c7),
    url(/vndrly-background.jpg) center / cover fixed;
}
.public-legal *, .public-legal { box-sizing: border-box; }
.public-legal .document { max-width: 768px; margin: auto; }
.public-legal header { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
.public-legal header img { display: block; width: 48px; height: 48px; border-radius: 8px; object-fit: contain; }
.public-legal h1 { margin: 0; color: #fff; font-size: 24px; line-height: 1.25; font-weight: 700; }
.public-legal header p { color: #d1d5db; margin: 6px 0 0; }
.public-legal h2 { margin: 0 0 12px; color: #fff; font-size: 18px; line-height: 1.4; font-weight: 600; }
.public-legal a { color: var(--legal-accent); text-underline-offset: 3px; }
.public-legal a:hover { color: #fcd34d; }
.public-legal nav { margin: 0 0 20px; }
.public-legal main {
  border: 1px solid var(--legal-primary);
  border-radius: 14px;
  padding: 24px;
  background: #242426 !important;
  box-shadow: 0 8px 24px #0004;
}
.public-legal section + section { border-top: 1px solid #ffffff26; margin-top: 24px; padding-top: 24px; }
.public-legal p { margin: 0 0 16px; }
.public-legal input[type=tel] {
  display: block;
  width: min(100%, 320px);
  min-height: 44px;
  border: 1px solid var(--legal-primary);
  border-radius: 8px;
  padding: 8px 12px;
  margin-top: 6px;
  background: #303034;
  color: inherit;
  font: inherit;
}
.public-legal input[type=tel]::placeholder { color: #b3b3b3; }
.public-legal .consent-choice {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  border: 1px solid #55555a;
  border-radius: 10px;
  background: #2b2b2f;
  padding: 12px;
  cursor: pointer;
}
.public-legal input[type=checkbox] { appearance: auto; accent-color: var(--legal-primary); margin: 4px 0 0; width: 16px; height: 16px; flex: none; }
.public-legal button {
  border: 1px solid var(--legal-primary);
  border-radius: 8px;
  background: #2b2b2f;
  color: #f3f4f6;
  font: 600 13px system-ui, sans-serif;
  padding: 8px 12px;
}
.public-legal button { min-height: 44px; cursor: pointer; }
.public-legal button:hover { background: #353539; color: var(--legal-accent); }
.public-legal button:disabled { opacity: .6; cursor: wait; }
.public-legal :focus-visible { outline: 2px solid var(--legal-accent); outline-offset: 3px; }
.public-legal .back { display: inline-flex; align-items: center; gap: 8px; text-decoration: none; font-weight: 600; }
.public-legal .back-icon { width: 32px; height: 32px; position: relative; display: inline-block; flex-shrink: 0; }
.public-legal .back-icon::before { content: ""; position: absolute; inset: 0; background: var(--legal-primary); mask: url(/legal-assets/back-sphere.png) center / contain no-repeat; }
.public-legal .back-icon img { position: absolute; inset: 0; width: 100%; height: 100%; }
.public-legal .back-gloss { opacity: 0; transition: opacity .2s; }
.public-legal .back:hover .back-gloss { opacity: 1; }
.public-legal .back-arrow { position: absolute; inset: 18%; width: 64%; height: 64%; color: var(--brand-icon-color, #242426); }
@media (prefers-reduced-motion: no-preference) {
  .public-legal .back-icon { transition: transform .15s; }
  .public-legal .back:hover .back-icon { transform: scale(1.1); }
}
.public-legal .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 20px; }
.public-legal .language {
  position: fixed;
  z-index: 40;
  top: 4px;
  right: 20px;
  height: 48px;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
}
.public-legal .language a { display: inline-flex; align-items: center; min-height: 36px; text-decoration: none; }
.public-legal .language a {
  min-height: 44px;
  border: 0;
  background: none;
  padding: 0 4px;
  color: #bdbdbd;
  font: 700 14px system-ui, sans-serif;
}
.public-legal .language a[aria-current],
.public-legal .language a:hover { color: var(--legal-primary); }
.public-legal .language .language-slider { padding: 0; }
.language-slider span {
  display: block;
  width: 44px;
  height: 24px;
  padding: 3px;
  border-radius: 12px;
  background: var(--legal-primary);
}
.language-slider span::after {
  content: "";
  display: block;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--brand-icon-color, #242426);
}
.language-slider:has(+ a[aria-current]) span::after { transform: translateX(20px); }
.public-legal footer { border-top: 1px solid #ffffff33; margin-top: 24px; padding-top: 16px; color: #b3b3b3; font-size: 12px; }
.public-legal footer p { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.public-legal footer a:last-child { margin-inline-start: auto; text-align: end; }
@media (max-width: 639px) {
  .public-legal .language { right: 8px; }
}
@media (max-width: 480px) {
  .public-legal { padding: 56px 12px 24px; }
  .public-legal main { padding: 16px; }
  .public-legal h1 { font-size: 18px; }
  .public-legal .language { gap: 2px; }
  .public-legal .language a { font-size: 12px; padding-inline: 2px; }
}
</style></head><body><div class="public-legal ${slug}"><div class="document"><div class="toolbar"><a class="back" href="/login"><span class="back-icon" aria-hidden="true"><svg class="back-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7M5 12h14"/></svg></span>Back to sign in</a><nav class="language" aria-label="Language">${englishLink}${slider}${spanishLink}</nav></div><header><a href="/login" aria-label="VNDRLY sign in"><img src="${escapeHtml(logoUrl)}" alt="" width="48" height="48"></a><div><h1>VNDRLY ${escapeHtml(title)}</h1><p>Effective ${escapeHtml(LEGAL_EFFECTIVE_DATE)}</p></div></header><nav><a href="/legal/privacy/">Privacy Policy</a> · <a href="/legal/terms/">Terms & Conditions</a> · <a href="/sms/">SMS Enrollment</a></nav><main>${body}</main><footer><p><a class="back" href="/login"><span class="back-icon" aria-hidden="true"><svg class="back-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7M5 12h14"/></svg></span>Back to sign in</a><a href="mailto:${escapeHtml(LEGAL_CONTACT_EMAIL)}">${escapeHtml(LEGAL_CONTACT_EMAIL)}</a></p></footer></div></div></body></html>`;
  return language === "es" ? translatePublicHtml(page) : page;
}
