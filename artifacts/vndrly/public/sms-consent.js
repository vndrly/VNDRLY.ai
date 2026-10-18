/* Progressive enhancement only: the enrollment form and disclosures are plain HTML. */
(() => {
  const form = document.getElementById("sms-consent-form");
  const result = document.getElementById("sms-result");
  if (!form || !result) return;
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    result.textContent = "Saving your choice…";
    try {
      const response = await fetch(form.action, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      const payload = await response.json();
      result.textContent = payload.message || (response.ok ? "Your SMS consent is saved." : "Could not save your choice. Please sign in and try again.");
      if (response.ok) { form.reset(); }
    } catch {
      result.textContent = "The save could not be confirmed. Please check your connection and try again. This form does not send text messages.";
    } finally { button.disabled = false; }
  });
})();
