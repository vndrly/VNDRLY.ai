import type { FormEvent } from "react";
import { renderPublicMessagingHtml, renderPublicPrivacyHtml, renderPublicTermsHtml } from "@/lib/public-legal-html";

/** The app preview and deployed static documents share one public, bilingual form. */
export function PublicLegalView({ kind }: { kind: "privacy" | "terms" | "messaging" }) {
  const language = window.location.pathname.startsWith("/es/") ? "es" : "en";
  const render = kind === "privacy" ? renderPublicPrivacyHtml : kind === "terms" ? renderPublicTermsHtml : renderPublicMessagingHtml;
  const html = render(language);
  const content = html.match(/<style>([\s\S]*?)<\/style>/)![0] + html.match(/<body>([\s\S]*)<\/body>/)![1].replace(/<script[^>]*><\/script>/g, "");
  async function submit(event: FormEvent<HTMLDivElement>) {
    if (!(event.target instanceof HTMLFormElement)) return;
    event.preventDefault();
    const form = event.target;
    const output = form.querySelector<HTMLElement>("#sms-result")!;
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    button.disabled = true;
    output.textContent = language === "es" ? "Guardando su elección…" : "Saving your choice…";
    try {
      const response = await fetch(form.action, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      const payload = await response.json();
      output.textContent = language === "es" ? (response.ok ? "Su consentimiento SMS está guardado. Este formulario no envía mensajes ni elimina bloqueos STOP previos." : "No se pudo guardar. Inicie sesión, compruebe su número y consentimiento e inténtelo de nuevo.") : payload.message;
      if (response.ok) form.reset();
    } catch { output.textContent = language === "es" ? "No se pudo confirmar el guardado. Compruebe su conexión e inténtelo de nuevo." : "The save could not be confirmed. Check your connection and try again."; }
    finally { button.disabled = false; }
  }
  // Content comes exclusively from the escaped, version-controlled legal renderer.
  return <div lang={language} onSubmit={submit} dangerouslySetInnerHTML={{ __html: content }} />;
}
