import { describe, expect, it } from "vitest";
import { renderPublicMessagingHtml, renderPublicTermsHtml, renderPublicPrivacyHtml } from "./public-legal-html";
import { PUBLIC_SMS_CONSENT_DISCLOSURE, PUBLIC_SMS_CONSENT_DISCLOSURE_ES } from "@workspace/api-zod/legal-policy";
import { TERMS_SECTIONS } from "./legal-docs";
describe("public carrier-review documents", () => {
  it("exposes a real enrollment form and unchecked choice without running JavaScript", () => {
    const doc = new DOMParser().parseFromString(renderPublicMessagingHtml(), "text/html");
    const form = doc.querySelector("form")!;
    expect(form.getAttribute("action")).toBe("/api/notifications/sms-consent");
    expect(form.getAttribute("method")).toBe("post");
    expect(form.querySelector('input[type="tel"]')).not.toBeNull();
    const checkbox = form.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(checkbox.disabled).toBe(false); expect(checkbox.checked).toBe(false);
    expect(form.textContent).toContain(PUBLIC_SMS_CONSENT_DISCLOSURE);
    expect(form.querySelector('a[href="/legal/privacy/"]')).not.toBeNull();
    expect(form.querySelector('a[href="/legal/terms/"]')).not.toBeNull();
    expect(doc.querySelector("iframe")).toBeNull();
  });
  it("keeps every terms section available without JavaScript", () => {
    const doc = new DOMParser().parseFromString(renderPublicTermsHtml(), "text/html");
    for (const section of TERMS_SECTIONS) expect(doc.body.textContent).toContain(section.title);
    expect(doc.querySelector("script")).toBeNull();
  });
});

it("serves complete Spanish documents, a selected-language consent, and working EN/ES paths without JavaScript", () => {
  const english = new DOMParser().parseFromString(renderPublicMessagingHtml(), "text/html");
  const spanish = new DOMParser().parseFromString(renderPublicMessagingHtml("es"), "text/html");
  expect(spanish.documentElement.lang).toBe("es");
  expect(spanish.querySelector('input[name="language"]')?.getAttribute("value")).toBe("es");
  expect(spanish.querySelector("form")?.textContent).toContain(PUBLIC_SMS_CONSENT_DISCLOSURE_ES);
  expect(spanish.querySelector('.language a[lang="en"]')?.getAttribute("href")).toBe("/sms/");
  expect(english.querySelector('.language a[lang="es"]')?.getAttribute("href")).toBe("/es/sms/");
  expect(spanish.querySelector('a[href="/es/legal/privacy/"]')).not.toBeNull();
  for (const render of [renderPublicPrivacyHtml, renderPublicTermsHtml]) {
    const en = new DOMParser().parseFromString(render(), "text/html");
    const es = new DOMParser().parseFromString(render("es"), "text/html");
    expect(es.querySelectorAll("main section").length).toBe(en.querySelectorAll("main section").length);
    expect(es.querySelectorAll("main section p").length).toBe(en.querySelectorAll("main section p").length);
    expect(es.documentElement.lang).toBe("es");
  }
});
