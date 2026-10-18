import { describe, expect, it } from "vitest";
import { renderPublicMessagingHtml, renderPublicTermsHtml } from "./public-legal-html";
import { PUBLIC_SMS_CONSENT_DISCLOSURE } from "@workspace/api-zod/legal-policy";
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
