import { useState, type FormEvent } from "react";
import { LegalDocumentPage } from "@/components/legal-document-page";
import { PRIVACY_POLICY_SECTIONS, TERMS_SECTIONS } from "@/lib/legal-docs";
import { LEGAL_POLICY_VERSION, PUBLIC_SMS_CONSENT_DISCLOSURE } from "@workspace/api-zod/legal-policy";

export default function LegalMessagingConsentPage(): React.ReactElement {
  const [result, setResult] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setSaving(true);
    try {
      const response = await fetch("/api/notifications/sms-consent", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      const payload = await response.json();
      setResult(payload.message || "Please sign in and try again.");
      if (response.ok) form.reset();
    } catch { setResult("The save could not be confirmed. Check your connection and try again. No text was sent."); }
    finally { setSaving(false); }
  }
  return <LegalDocumentPage kind="messaging" title="SMS Enrollment" description="Choose optional VNDRLY operational text updates. Creating and using your account does not require SMS consent."
    sections={[...PRIVACY_POLICY_SECTIONS.filter(s => s.title === "Text Messaging and Mobile Information"), ...TERMS_SECTIONS.filter(s => s.title === "Messaging Terms")]}>
    <section className="mb-8 rounded-lg border border-slate-200 bg-white p-5" aria-label="SMS enrollment">
      <h2>Choose optional VNDRLY text updates</h2>
      <p><a href="/login">Sign in to VNDRLY</a> before saving, then return here.</p>
      <form action="/api/notifications/sms-consent" method="post" onSubmit={submit}>
        <input type="hidden" name="policyVersion" value={LEGAL_POLICY_VERSION} />
        <p><label htmlFor="sms-phone">Your mobile number (include + country code)</label><br /><input id="sms-phone" name="phone" type="tel" autoComplete="tel" placeholder="+14055551234" maxLength={24} required /></p>
        <p><label><input type="checkbox" name="consent" value="yes" required /> {PUBLIC_SMS_CONSENT_DISCLOSURE}</label></p>
        <p><a href="/legal/privacy/">Privacy Policy</a> · <a href="/legal/terms/">Terms & Conditions</a></p>
        <button type="submit" disabled={saving}>{saving ? "Saving…" : "Save my SMS consent"}</button>
        <p role="status" aria-live="polite">{result}</p>
      </form>
      <p>Gate workers must use the number saved on their current employee profile. We record your account, number, consent wording, policy version and time. Consent grants no new permissions or message types. This form sends no text and does not remove a prior carrier STOP block.</p>
    </section>
  </LegalDocumentPage>;
}
