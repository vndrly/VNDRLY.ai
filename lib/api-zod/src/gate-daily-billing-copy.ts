/** Developer-authored labels only. Never translate saved post names, agreements or notes. */
const es: Readonly<Record<string, string>> = {
  "This partner’s billing authorization was revoked. Office review is required.":
    "Se revocó la autorización de facturación de este cliente. Se requiere revisión de oficina.",
  "The automatic billing direction changed. Refresh the setup.":
    "La instrucción de facturación automática cambió. Actualice la configuración.",
  Partner: "Cliente",
  Site: "Sitio",
  AFE: "AFE",
  Job: "Trabajo",
  "Select an accepted job with a partner-assigned AFE and Gate authorization.":
    "Seleccione un trabajo aceptado con un AFE asignado por el cliente y autorización de acceso.",
  "Period daily rate": "Tarifa diaria del período",
  "This post’s billing site or partner changed. Office review is required.":
    "El sitio o cliente de facturación de este puesto cambió. Se requiere revisión de oficina.",
  "Automatic billing needs office review.":
    "La facturación automática requiere revisión de oficina.",
  "Partial or missing recorded coverage pauses automatic billing for office review.":
    "La cobertura registrada parcial o faltante pausa la facturación automática para su revisión en oficina.",
  "Gate daily billing": "Facturación diaria de puestos",
  "Gate post": "Puesto de acceso",
  "Choose a post": "Elegir un puesto",
  "Load more posts": "Cargar más puestos",
  "Working…": "Procesando…",
  "No authorized gate posts.": "No hay puestos de acceso autorizados.",
  "Approved daily service": "Servicio diario aprobado",
  "Choose an approved service": "Elegir un servicio aprobado",
  "Period starts": "Inicio del período",
  "Agreement reference": "Referencia del acuerdo",
  "Partial-day billing": "Facturación de días parciales",
  "Full daily rate": "Tarifa diaria completa",
  "Prorate by actual day length": "Prorratear por la duración real del día",
  "Confirm this starts after all previously billed days.":
    "Confirmo que comienza después de todos los días ya facturados.",
  "Automatic billing": "Facturación automática",
  "Interval in completed days": "Intervalo en días completos",
  "Save billing setup": "Guardar configuración de facturación",
  "Start next billing ticket": "Iniciar el siguiente ticket de facturación",
  "Invoice Now": "Facturar ahora",
  "Retry request": "Reintentar solicitud",
  "Refresh preview": "Actualizar vista previa",
  "Current ticket": "Ticket actual",
  "Last billed through": "Último día facturado",
  Through: "Hasta",
  "Recorded billable days": "Días facturables registrados",
  Total: "Total",
  "Staff shifts and Gate coverage continue independently of billing.":
    "Los turnos y la cobertura del puesto continúan independientemente de la facturación.",
  "Billing includes only completed days in Central time.":
    "La facturación incluye solo días completos en la hora central.",
  "Partner approval is required before the invoice is generated.":
    "Se requiere la aprobación del cliente antes de generar la factura.",
  "Some days have partial or missing recorded coverage. Review before submitting.":
    "Algunos días tienen cobertura registrada parcial o faltante. Revísela antes de enviar.",
  "No completed billable days yet.":
    "Todavía no hay días facturables completos.",
  "Submitted ticket {ticket} for partner approval.":
    "Ticket {ticket} enviado para aprobación del cliente.",
  "Next ticket: {ticket}.": "Siguiente ticket: {ticket}.",
  "Billing stopped after this period.":
    "La facturación terminó después de este período.",
  "Billing is not due yet.": "La facturación aún no corresponde.",
  "Close the current period before changing its agreement.":
    "Cierre el período actual antes de cambiar su acuerdo.",
  "Choose an approved per-day service before starting billing.":
    "Elija un servicio con tarifa diaria aprobada antes de iniciar la facturación.",
  "Office billing access is required.":
    "Se requiere acceso de oficina a la facturación.",
  "Sign in again to continue billing.":
    "Vuelva a iniciar sesión para continuar la facturación.",
  "The billing preview changed. Refresh it and review again.":
    "La vista previa cambió. Actualícela y vuelva a revisarla.",
  "This agreement needs pricing review before daily billing.":
    "Este acuerdo requiere revisar el precio antes de facturar por día.",
  "Review the existing ticket before creating this bill.":
    "Revise el ticket existente antes de crear esta factura.",
  "This period overlaps days that were already billed.":
    "Este período se superpone con días ya facturados.",
  "Billing could not be confirmed. Retry the same request.":
    "No se pudo confirmar la facturación. Reintente la misma solicitud.",
  "Billing setup needs attention. Review the selected post and agreement.":
    "La configuración requiere atención. Revise el puesto y el acuerdo seleccionados.",
  "Automatic billing submits reviewed coverage at the saved interval; partner approval still applies.":
    "La facturación automática envía la cobertura revisada en el intervalo guardado; aún se requiere la aprobación del cliente.",
  "Per day": "Por día",
};
export function gateDailyBillingCopy(text: string, language: string) {
  return language.toLowerCase().startsWith("es") ? (es[text] ?? text) : text;
}
export function gateDailyBillingError(code: string, language: string) {
  const text =
    code.includes("office_required") || code.includes("post_forbidden")
      ? "Office billing access is required."
      : code.startsWith("auth.") || code.startsWith("workday.")
        ? "Sign in again to continue billing."
        : code.endsWith("version_conflict") || code.endsWith("preview_changed")
          ? "The billing preview changed. Refresh it and review again."
          : code.endsWith("accepted_job_required") || code.endsWith("job_afe_required")
            ? "Select an accepted job with a partner-assigned AFE and Gate authorization."
          : code.endsWith("approved_daily_terms_required") ||
              code.endsWith("precise_agreement_review_required")
            ? "This agreement needs pricing review before daily billing."
            : code.endsWith("commercial_authority_revoked")
              ? "This partner’s billing authorization was revoked. Office review is required."
              : code.endsWith("schedule_direction_changed")
                ? "The automatic billing direction changed. Refresh the setup."
                : code.endsWith("context_changed")
                  ? "This post’s billing site or partner changed. Office review is required."
                  : code.endsWith("ticket_review_required")
                    ? "Review the existing ticket before creating this bill."
                    : code.endsWith("period_already_billed")
                      ? "This period overlaps days that were already billed."
                      : code.endsWith("close_period_before_terms_change")
                        ? "Close the current period before changing its agreement."
                        : code.endsWith("no_completed_billable_days")
                          ? "No completed billable days yet."
                          : code.endsWith("invalid_request")
                            ? "Billing setup needs attention. Review the selected post and agreement."
                            : "Billing could not be confirmed. Retry the same request.";
  return gateDailyBillingCopy(text, language);
}
