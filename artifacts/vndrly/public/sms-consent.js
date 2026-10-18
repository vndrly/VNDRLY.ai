/* Progressive enhancement only: the enrollment form and disclosures are plain HTML. */
(() => {
  const form = document.getElementById("sms-consent-form");
  const result = document.getElementById("sms-result");
  if (!form || !result) return;
  const spanish = form.elements.language?.value === "es";
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    result.textContent = spanish ? "Guardando su elección…" : "Saving your choice…";
    try {
      const response = await fetch(form.action, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      const payload = await response.json();
      result.textContent = spanish ? (response.ok ? "Su consentimiento SMS está guardado. Los mensajes dependen de los procesos disponibles, la aprobación de la campaña y los bloqueos STOP del operador. Responda START al número de VNDRLY para revertir un bloqueo STOP previo; este formulario no lo elimina ni envía mensajes." : response.status === 401 ? "Inicie sesión en VNDRLY y regrese a este formulario para guardar su elección." : "No se pudo guardar. Compruebe su número, consentimiento y sesión. El personal de acceso debe utilizar el número de su perfil de empleado actual.") : payload.message || (response.ok ? "Your SMS consent is saved." : "Could not save your choice. Please sign in and try again.");
      if (response.ok) { form.reset(); }
    } catch {
      result.textContent = spanish ? "No se pudo confirmar el guardado. Compruebe su conexión e inténtelo de nuevo. Este formulario no envía mensajes." : "The save could not be confirmed. Please check your connection and try again. This form does not send text messages.";
    } finally { button.disabled = false; }
  });
})();
