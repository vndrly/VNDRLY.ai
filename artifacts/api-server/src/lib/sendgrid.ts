// Outbound email delivery is disabled (not configured yet).
// Call sites remain so paid-tier email can be wired later without API churn.
import { type PushWarning } from "@workspace/api-zod";
import { logger } from "./logger";

const SKIP = "Outbound email skipped (email delivery disabled)";

export type EmailLocale = "en" | "es";

const INVOICE_COPY = {
  en: {
    bandSubtitle: "Field Operations Invoice",
    subject: (vendor: string, num: string, total: string) =>
      `${vendor} — Invoice ${num} (${total} due)`,
    greet: (partner: string) => `Hi ${partner},`,
    body: (vendor: string, num: string) =>
      `Please find attached invoice <strong>${num}</strong> from <strong>${vendor}</strong>.`,
    bodyText: (vendor: string, num: string) =>
      `Please find attached invoice ${num} from ${vendor}.`,
    dueOn: (d: string) => `Due ${d}`,
    dueOnReceipt: "Due on receipt",
    closing: "Thank you for your business.",
    note: "Note from",
  },
  es: {
    bandSubtitle: "Factura de Operaciones de Campo",
    subject: (vendor: string, num: string, total: string) =>
      `${vendor} — Factura ${num} (${total} pendiente)`,
    greet: (partner: string) => `Hola ${partner},`,
    body: (vendor: string, num: string) =>
      `Adjuntamos la factura <strong>${num}</strong> de <strong>${vendor}</strong>.`,
    bodyText: (vendor: string, num: string) =>
      `Adjuntamos la factura ${num} de ${vendor}.`,
    dueOn: (d: string) => `Vence el ${d}`,
    dueOnReceipt: "Pago contra recibo",
    closing: "Gracias por su preferencia.",
    note: "Nota de",
  },
} as const;

export interface SendInvoiceEmailInput {
  to: string;
  cc?: string[];
  vendorName: string;
  partnerName: string;
  invoiceNumber: string;
  totalDue: string;
  dueDate: string | null;
  pdfBuf: Buffer;
  notesFromSender?: string;
  locale?: EmailLocale;
}

export async function sendInvoiceEmail(
  input: SendInvoiceEmailInput,
): Promise<{ messageId: string | undefined }> {
  logger.debug({ fn: "sendInvoiceEmail" }, SKIP);
  return { messageId: undefined };
}

const REMINDER_COPY = {
  en: {
    bandSubtitle: "Payment Reminder",
    overdueText: (d: number) => `${d} day${d === 1 ? "" : "s"} past due`,
    dueOn: (d: string) => `Due ${d}`,
    dueOnReceipt: "Due on receipt",
    subjectOverdue: (num: string, ctx: string) =>
      `Reminder — Invoice ${num} is ${ctx}`,
    subject: (num: string) => `Reminder — Invoice ${num}`,
    greet: (partner: string) => `Hi ${partner},`,
    body: (vendor: string, num: string) =>
      `This is a friendly reminder from <strong>${vendor}</strong> that invoice <strong>${num}</strong> has an outstanding balance.`,
    bodyText: (vendor: string, num: string, balance: string, ctx: string) =>
      `Reminder: ${vendor} invoice ${num} has ${balance} outstanding (${ctx}).`,
    balanceLine: (balance: string, ctx: string) =>
      `${balance} balance due — ${ctx}`,
    closing: "Please reply to this email if you have any questions.",
    note: "Note",
  },
  es: {
    bandSubtitle: "Recordatorio de pago",
    overdueText: (d: number) =>
      `${d} día${d === 1 ? "" : "s"} de atraso`,
    dueOn: (d: string) => `Vence el ${d}`,
    dueOnReceipt: "Pago contra recibo",
    subjectOverdue: (num: string, ctx: string) =>
      `Recordatorio — Factura ${num} con ${ctx}`,
    subject: (num: string) => `Recordatorio — Factura ${num}`,
    greet: (partner: string) => `Hola ${partner},`,
    body: (vendor: string, num: string) =>
      `Le recordamos que <strong>${vendor}</strong> tiene un saldo pendiente en la factura <strong>${num}</strong>.`,
    bodyText: (vendor: string, num: string, balance: string, ctx: string) =>
      `Recordatorio: la factura ${num} de ${vendor} tiene ${balance} pendiente (${ctx}).`,
    balanceLine: (balance: string, ctx: string) =>
      `${balance} pendiente — ${ctx}`,
    closing: "Por favor responda a este correo si tiene alguna pregunta.",
    note: "Nota",
  },
} as const;

export interface SendInvoiceReminderInput {
  to: string;
  cc?: string[];
  vendorName: string;
  partnerName: string;
  invoiceNumber: string;
  balanceDue: string;
  dueDate: string | null;
  daysPastDue: number | null;
  reminderKind: "manual" | "aging";
  notesFromSender?: string;
  locale?: EmailLocale;
}

export async function sendInvoiceReminderEmail(
  input: SendInvoiceReminderInput,
): Promise<{ messageId: string | undefined }> {
  logger.debug({ fn: "sendInvoiceReminderEmail" }, SKIP);
  return { messageId: undefined };
}

// ─── 1099 recipient e-delivery ─────────────────────────────────
//
// Vendors who consented to electronic delivery (IRS Pub 1179 / Reg
// §31.6051-1(j)) receive their copy of the 1099 form as a PDF attached to
// this email. The branding mirrors the invoice/reminder emails so the
// vendor recognizes it as a VNDRLY communication.

export interface Send1099RecipientEmailInput {
  to: string;
  vendorName: string;
  partnerName: string;
  taxYear: number;
  formType: "NEC" | "MISC" | "K";
  totalReportable: string;
  pdfBuf: Buffer;
  /** Optional partner-customized subject template. May contain the
   *  placeholders documented in {@link substitute1099Placeholders}. When
   *  null/blank, the hardcoded English default is used. */
  subjectTemplate?: string | null;
  /** Optional partner-customized plain-text body template. Same
   *  placeholders as {@link subjectTemplate}. Newlines are preserved
   *  in both the text and HTML parts (the HTML uses
   *  white-space:pre-wrap so partners don't have to write `<br>`s). */
  bodyTemplate?: string | null;
  /**
   * Optional SendGrid `customArgs` map. The 1099 deliver flow uses this
   * to tag each send with the (taxYear, formType, payerPartnerId,
   * recipientVendorId) tuple so the SendGrid event-webhook handler can
   * map an inbound `delivered`/`open`/`bounce` event back to the
   * matching `tax_1099_filings` row even when the stored `x-message-id`
   * lookup misses.
   */
  customArgs?: Record<string, string>;
}

/** Substitute the supported `{{placeholder}}` tokens in a partner
 *  customized 1099 email template. Tokens are case-sensitive and an
 *  unrecognized `{{...}}` is left untouched so partners notice the
 *  typo instead of silently shipping a literal `{{vendor}}` to a
 *  vendor's inbox. */
export function substitute1099Placeholders(
  template: string,
  vars: {
    vendorName: string;
    partnerName: string;
    taxYear: number;
    formType: "NEC" | "MISC" | "K";
    totalReportable: string;
  },
): string {
  const formLabel = `1099-${vars.formType}`;
  const map: Record<string, string> = {
    vendorName: vars.vendorName,
    partnerName: vars.partnerName,
    taxYear: String(vars.taxYear),
    formType: vars.formType,
    formLabel,
    totalReportable: vars.totalReportable,
  };
  return template.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(map, key) ? map[key] : match,
  );
}

export async function send1099RecipientEmail(
  input: Send1099RecipientEmailInput,
): Promise<{ messageId: string | undefined }> {
  logger.debug({ fn: "send1099RecipientEmail" }, SKIP);
  return { messageId: undefined };
}

// ─────────────────────────────────────────────────────────────────
// Accounting push failure digest
//
// Sent to vendor admins after a QBO/OpenAccountant push that produced any
// per-row warnings. The body summarizes counts by kind and links the admin
// straight to the audit row in the Reports page so they can open the
// "Sync details" dialog and decide whether to retry.
// ─────────────────────────────────────────────────────────────────

const ACCOUNTING_DIGEST_COPY = {
  en: {
    bandSubtitle: "Accounting sync digest",
    subject: (provider: string, total: number) =>
      `${provider} sync — ${total} row${total === 1 ? "" : "s"} need attention`,
    greet: "Hi,",
    intro: (provider: string, vendor: string, period: string) =>
      `A ${provider} sync for <strong>${vendor}</strong> (${period}) finished with rows that need your attention.`,
    introText: (provider: string, vendor: string, period: string) =>
      `A ${provider} sync for ${vendor} (${period}) finished with rows that need your attention.`,
    countsHeading: "Failed rows by kind",
    kind: { customer: "Customers", vendor: "Vendors", invoice: "Invoices" } as Record<
      string,
      string
    >,
    syncedHeading: "Synced this run",
    syncedCustomers: (n: number) =>
      `${n} customer${n === 1 ? "" : "s"} created`,
    syncedVendors: (n: number) => `${n} vendor${n === 1 ? "" : "s"} created`,
    syncedInvoices: (n: number) => `${n} invoice${n === 1 ? "" : "s"} created`,
    warningsHeading: "Warnings",
    reconciliationHeading: "Reconciliation drift also detected",
    reconciliationBlurb: (provider: string) =>
      `In addition to the failed rows above, the post-push check also found totals or per-state tax that don't match what ${provider} stored. Drift like this usually points at a tax-rate or tax-mapping mismatch — review the per-state details below before retrying.`,
    reconciliationPerInvoice: (n: number) =>
      `${n} invoice${n === 1 ? "" : "s"} drifted from the accounting system`,
    reconciliationPerState: (n: number) =>
      `${n} state total${n === 1 ? "" : "s"} off`,
    reconciliationFetchSkipped: (n: number) =>
      `${n} reconciliation check${n === 1 ? "" : "s"} skipped (couldn't read invoices back)`,
    cta: "Open audit details",
    warningsListCta: "Show only syncs with warnings",
    closing:
      "You can retry just the failed rows from the audit details dialog.",
    note: "Want to stop receiving these? Turn off accounting failure emails on the Reports page.",
  },
  es: {
    bandSubtitle: "Resumen de sincronización contable",
    subject: (provider: string, total: number) =>
      `${provider} — ${total} fila${total === 1 ? "" : "s"} requiere${
        total === 1 ? "" : "n"
      } atención`,
    greet: "Hola,",
    intro: (provider: string, vendor: string, period: string) =>
      `Una sincronización de ${provider} para <strong>${vendor}</strong> (${period}) finalizó con filas que requieren su atención.`,
    introText: (provider: string, vendor: string, period: string) =>
      `Una sincronización de ${provider} para ${vendor} (${period}) finalizó con filas que requieren su atención.`,
    countsHeading: "Filas fallidas por tipo",
    kind: {
      customer: "Clientes",
      vendor: "Proveedores",
      invoice: "Facturas",
    } as Record<string, string>,
    syncedHeading: "Sincronizado en esta ejecución",
    syncedCustomers: (n: number) =>
      `${n} cliente${n === 1 ? "" : "s"} creado${n === 1 ? "" : "s"}`,
    syncedVendors: (n: number) =>
      `${n} proveedor${n === 1 ? "" : "es"} creado${n === 1 ? "" : "s"}`,
    syncedInvoices: (n: number) =>
      `${n} factura${n === 1 ? "" : "s"} creada${n === 1 ? "" : "s"}`,
    warningsHeading: "Avisos",
    reconciliationHeading: "También se detectó discrepancia de conciliación",
    reconciliationBlurb: (provider: string) =>
      `Además de las filas fallidas anteriores, la verificación posterior encontró totales o impuestos por estado que no coinciden con lo registrado en ${provider}. Una discrepancia así normalmente indica una tasa o asignación de impuestos desalineada — revise el desglose por estado antes de reintentar.`,
    reconciliationPerInvoice: (n: number) =>
      `${n} factura${n === 1 ? "" : "s"} con discrepancia frente al sistema contable`,
    reconciliationPerState: (n: number) =>
      `${n} total${n === 1 ? "" : "es"} por estado con desviación`,
    reconciliationFetchSkipped: (n: number) =>
      `${n} verificación${n === 1 ? "" : "es"} de conciliación omitida${n === 1 ? "" : "s"} (no se pudieron releer las facturas)`,
    cta: "Abrir detalles del registro",
    warningsListCta: "Mostrar solo sincronizaciones con avisos",
    closing:
      "Puede reintentar solo las filas fallidas desde el cuadro de detalles del registro.",
    note: "¿No quieres recibir estos correos? Desactiva las notificaciones de fallas contables en la página de Reportes.",
  },
} as const;

export interface AccountingDigestRecipient {
  email: string;
  locale?: EmailLocale;
}

export interface AccountingPushDigestInput {
  recipients: AccountingDigestRecipient[];
  vendorName: string;
  provider: "QuickBooks" | "OpenAccountant";
  periodLabel: string;
  auditDetailUrl: string;
  /** Optional secondary deep link that opens the Reports page with the
   *  "Only show syncs with warnings" toggle pre-applied so admins can
   *  triage every problem sync (not just the one row this digest is
   *  anchored to) in one click. Omitted in older callers / tests, in
   *  which case the email falls back to just the per-row CTA. */
  auditWarningsUrl?: string;
  countsByKind: { customer: number; vendor: number; invoice: number };
  customersCreated: number;
  vendorsCreated: number;
  invoicesCreated: number;
  /** The full per-row warning list from the push. Rendered into the
   *  email body using the same formatter as the Reports page "Copy all"
   *  button so admins see the exact same wording in their inbox that they
   *  would see if they opened the audit details dialog. */
  warnings: PushWarning[];
  /** Optional reconciliation call-out. When the same push that produced
   *  per-row failures also surfaced post-push reconciliation drift
   *  (totals or per-state tax that don't match what the accounting
   *  system stored), the failure digest renders a dedicated section so
   *  admins notice the drift instead of having it lump silently into
   *  the warning list. Omit / leave all bucket counts at 0 to skip the
   *  call-out. */
  reconciliation?: {
    countsByBucket: {
      perInvoice: number;
      perState: number;
      fetchSkipped: number;
    };
    /** The reconciliation-only subset of `warnings`, formatted line-by-
     *  line just like the main warning list. Capped by the same
     *  MAX_EMAIL_WARNING_LINES limit. */
    warnings: PushWarning[];
  };
}

/** Cap how many warning lines we render in the email body. QBO syncs can
 *  produce hundreds of warnings on bad runs and SendGrid will reject (or
 *  truncate) very large messages; the link to the audit details dialog
 *  always shows the full list. */
const MAX_EMAIL_WARNING_LINES = 50;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendAccountingPushDigestEmail(
  input: AccountingPushDigestInput,
): Promise<{ messageId: string | undefined } | null> {
  logger.debug({ fn: "sendAccountingPushDigestEmail" }, SKIP);
  return { messageId: undefined };
}

// ─────────────────────────────────────────────────────────────────
// Accounting reconciliation-only digest
//
// Sent to vendor admins after a QBO/OpenAccountant push that posted every
// row successfully but where the post-push reconciler found drift between
// VNDRLY's totals/per-state tax and what the accounting system stored.
// Distinct from the failure digest because the operational signal — and
// the fix — is different: per-row failures usually mean a missing
// customer/vendor or a data shape problem the admin should retry; quiet
// reconciliation drift almost always means a tax mapping or rate is out
// of sync between the two systems and needs a config change rather than a
// retry.
// ─────────────────────────────────────────────────────────────────

const RECONCILIATION_DIGEST_COPY = {
  en: {
    bandSubtitle: "Accounting reconciliation drift",
    subject: (provider: string, total: number) =>
      `${provider} sync — ${total} reconciliation issue${total === 1 ? "" : "s"} detected`,
    greet: "Hi,",
    intro: (provider: string, vendor: string, period: string) =>
      `A ${provider} sync for <strong>${vendor}</strong> (${period}) posted every row, but the post-push check found <strong>totals or per-state tax that don't match VNDRLY</strong>.`,
    introText: (provider: string, vendor: string, period: string) =>
      `A ${provider} sync for ${vendor} (${period}) posted every row, but the post-push check found totals or per-state tax that don't match VNDRLY.`,
    diagnosisHeading: "What this usually means",
    diagnosisBody:
      "All invoices posted successfully, so this is not a failed sync. Drift like this almost always means a tax rate or tax mapping differs between VNDRLY and your accounting system — the per-state breakdown below points at which jurisdiction to check first.",
    countsHeading: "Reconciliation issues",
    perInvoiceLabel: "Per-invoice mismatch",
    perStateLabel: "Per-state aggregate mismatch",
    fetchSkippedLabel: "Reconciliation skipped",
    syncedHeading: "Posted this run",
    syncedCustomers: (n: number) =>
      `${n} customer${n === 1 ? "" : "s"} created`,
    syncedVendors: (n: number) => `${n} vendor${n === 1 ? "" : "s"} created`,
    syncedInvoices: (n: number) => `${n} invoice${n === 1 ? "" : "s"} created`,
    warningsHeading: "Drift details",
    cta: "Open audit details",
    closing:
      "Open the audit row to see the full reconciliation report and decide whether to update a tax rate or remap an account.",
    note: "Want to stop receiving these? Turn off reconciliation drift emails on the Reports page.",
  },
  es: {
    bandSubtitle: "Discrepancia de conciliación contable",
    subject: (provider: string, total: number) =>
      `${provider} — ${total} discrepancia${total === 1 ? "" : "s"} de conciliación detectada${total === 1 ? "" : "s"}`,
    greet: "Hola,",
    intro: (provider: string, vendor: string, period: string) =>
      `Una sincronización de ${provider} para <strong>${vendor}</strong> (${period}) registró todas las filas, pero la verificación posterior encontró <strong>totales o impuestos por estado que no coinciden con VNDRLY</strong>.`,
    introText: (provider: string, vendor: string, period: string) =>
      `Una sincronización de ${provider} para ${vendor} (${period}) registró todas las filas, pero la verificación posterior encontró totales o impuestos por estado que no coinciden con VNDRLY.`,
    diagnosisHeading: "Qué significa esto normalmente",
    diagnosisBody:
      "Todas las facturas se registraron correctamente, por lo que no es una sincronización fallida. Una discrepancia así casi siempre significa que una tasa o asignación de impuestos difiere entre VNDRLY y su sistema contable — el desglose por estado a continuación indica qué jurisdicción revisar primero.",
    countsHeading: "Problemas de conciliación",
    perInvoiceLabel: "Discrepancia por factura",
    perStateLabel: "Discrepancia agregada por estado",
    fetchSkippedLabel: "Conciliación omitida",
    syncedHeading: "Registrado en esta ejecución",
    syncedCustomers: (n: number) =>
      `${n} cliente${n === 1 ? "" : "s"} creado${n === 1 ? "" : "s"}`,
    syncedVendors: (n: number) =>
      `${n} proveedor${n === 1 ? "" : "es"} creado${n === 1 ? "" : "s"}`,
    syncedInvoices: (n: number) =>
      `${n} factura${n === 1 ? "" : "s"} creada${n === 1 ? "" : "s"}`,
    warningsHeading: "Detalles de discrepancia",
    cta: "Abrir detalles del registro",
    closing:
      "Abra el registro de auditoría para ver el informe completo de conciliación y decidir si actualizar una tasa de impuesto o reasignar una cuenta.",
    note: "¿No quieres recibir estos correos? Desactiva los correos de discrepancia de conciliación en la página de Reportes.",
  },
} as const;

export interface AccountingReconciliationDigestInput {
  recipients: AccountingDigestRecipient[];
  vendorName: string;
  provider: "QuickBooks" | "OpenAccountant";
  periodLabel: string;
  auditDetailUrl: string;
  /** Bucketed counts so the email can lead with "3 invoices drifted, 2
   *  states drifted" before showing the full warning list. */
  countsByBucket: {
    perInvoice: number;
    perState: number;
    fetchSkipped: number;
  };
  customersCreated: number;
  vendorsCreated: number;
  invoicesCreated: number;
  /** The reconciliation-only warning list, formatted line-by-line by the
   *  shared formatter so the email body matches the Reports page exactly. */
  warnings: PushWarning[];
}

export async function sendAccountingReconciliationDigestEmail(
  input: AccountingReconciliationDigestInput,
): Promise<{ messageId: string | undefined } | null> {
  logger.debug({ fn: "sendAccountingReconciliationDigestEmail" }, SKIP);
  return { messageId: undefined };
}

// ─────────────────────────────────────────────────────────────────
// Accounting reconciliation — weekly recap
//
// Task #368. Sent by `reconciliation-weekly-recap` worker once per
// vendor per ISO week (when the vendor has opted into reconciliation
// alerts AND switched cadence to "weekly_recap"). Aggregates the past
// 7 days of `report_export_audit_log` rows that surfaced
// reconciliation drift instead of one email per push.
// ─────────────────────────────────────────────────────────────────

const RECONCILIATION_WEEKLY_RECAP_COPY = {
  en: {
    bandSubtitle: "Weekly reconciliation recap",
    subject: (vendor: string, weekLabel: string, total: number) =>
      `${vendor} — ${total} reconciliation issue${total === 1 ? "" : "s"} this week (${weekLabel})`,
    greet: "Hi,",
    intro: (vendor: string, windowLabel: string, total: number, pushes: number) =>
      `Here's the weekly reconciliation recap for <strong>${vendor}</strong> (${windowLabel}). VNDRLY detected <strong>${total} reconciliation issue${total === 1 ? "" : "s"}</strong> across ${pushes} push${pushes === 1 ? "" : "es"} that posted every row but where totals or per-state tax didn't match the accounting system.`,
    introText: (vendor: string, windowLabel: string, total: number, pushes: number) =>
      `Here's the weekly reconciliation recap for ${vendor} (${windowLabel}). VNDRLY detected ${total} reconciliation issue${total === 1 ? "" : "s"} across ${pushes} push${pushes === 1 ? "" : "es"} that posted every row but where totals or per-state tax didn't match the accounting system.`,
    perDayHeading: "Drift by day",
    countsHeading: "Issue breakdown",
    perInvoiceLabel: "Per-invoice mismatch",
    perStateLabel: "Per-state aggregate mismatch",
    fetchSkippedLabel: "Reconciliation skipped",
    worstHeading: "Worst offending invoices",
    worstInvoiceCount: (n: number) =>
      `${n} drift line${n === 1 ? "" : "s"}`,
    cta: "Open filtered audit log",
    closing:
      "The link above opens the Reports page filtered to this recap window so you can review every drifted push side-by-side.",
    note: "Want a per-push email instead, or to stop these alerts? Change reconciliation cadence on the Reports page.",
    noWarningsNote:
      "(If your audit log shows no rows at all, it's because no pushes ran during this window.)",
  },
  es: {
    bandSubtitle: "Resumen semanal de conciliación",
    subject: (vendor: string, weekLabel: string, total: number) =>
      `${vendor} — ${total} discrepancia${total === 1 ? "" : "s"} de conciliación esta semana (${weekLabel})`,
    greet: "Hola,",
    intro: (vendor: string, windowLabel: string, total: number, pushes: number) =>
      `Este es el resumen semanal de conciliación para <strong>${vendor}</strong> (${windowLabel}). VNDRLY detectó <strong>${total} discrepancia${total === 1 ? "" : "s"} de conciliación</strong> en ${pushes} sincronización${pushes === 1 ? "" : "es"} que registraron todas las filas pero donde los totales o impuestos por estado no coincidieron con el sistema contable.`,
    introText: (vendor: string, windowLabel: string, total: number, pushes: number) =>
      `Este es el resumen semanal de conciliación para ${vendor} (${windowLabel}). VNDRLY detectó ${total} discrepancia${total === 1 ? "" : "s"} de conciliación en ${pushes} sincronización${pushes === 1 ? "" : "es"} que registraron todas las filas pero donde los totales o impuestos por estado no coincidieron con el sistema contable.`,
    perDayHeading: "Discrepancias por día",
    countsHeading: "Desglose de problemas",
    perInvoiceLabel: "Discrepancia por factura",
    perStateLabel: "Discrepancia agregada por estado",
    fetchSkippedLabel: "Conciliación omitida",
    worstHeading: "Facturas con más discrepancias",
    worstInvoiceCount: (n: number) =>
      `${n} línea${n === 1 ? "" : "s"} de discrepancia`,
    cta: "Abrir registro de auditoría filtrado",
    closing:
      "El enlace anterior abre la página de Reportes filtrada a esta ventana para revisar cada sincronización con discrepancia.",
    note: "¿Prefieres un correo por sincronización o quieres detener estas alertas? Cambia la cadencia de conciliación en la página de Reportes.",
    noWarningsNote:
      "(Si tu registro de auditoría no muestra filas, es porque no se ejecutaron sincronizaciones durante esta ventana.)",
  },
} as const;

export interface ReconciliationWeeklyRecapPerDay {
  /** ISO date `YYYY-MM-DD` (UTC). */
  date: string;
  warningCount: number;
}

export interface ReconciliationWeeklyRecapWorstInvoice {
  /** Invoice display identifier (e.g. DocNumber or invoice id as a
   *  string). Source identifier carried verbatim from the audit warning. */
  identifier: string;
  warningCount: number;
}

export interface ReconciliationWeeklyRecapInput {
  recipients: AccountingDigestRecipient[];
  vendorName: string;
  /** ISO week label, e.g. "2026-W18". Surfaced in the subject and body. */
  weekLabel: string;
  /** Human-readable window label, e.g. "Apr 26 – May 03, 2026". */
  windowLabel: string;
  /** Deep link to the Reports page pre-filtered to the recap window
   *  with the warnings-only toggle on. */
  recapUrl: string;
  /** Number of distinct push audit rows in the window that surfaced
   *  drift. Drives the "across N pushes" copy. */
  pushCount: number;
  /** Total reconciliation warnings (all buckets) over the recap window. */
  totalWarnings: number;
  /** Per-day counts, oldest first, including zero-warning days inside
   *  the window so the chart reads as a stable 7-row block. */
  perDay: ReconciliationWeeklyRecapPerDay[];
  countsByBucket: {
    perInvoice: number;
    perState: number;
    fetchSkipped: number;
  };
  /** Top N invoices by warning count over the window. */
  worstInvoices: ReconciliationWeeklyRecapWorstInvoice[];
}

export async function sendReconciliationWeeklyRecapEmail(
  input: ReconciliationWeeklyRecapInput,
): Promise<{ messageId: string | undefined } | null> {
  logger.debug({ fn: "sendReconciliationWeeklyRecapEmail" }, SKIP);
  return { messageId: undefined };
}

export async function sendPasswordResetEmail(toEmail: string, resetUrl: string, displayName: string) {
  return;
}

// ─── Admin-issued temporary password ─────────────────────────────
//
// Sent when an org admin (system / partner / vendor) resets a user's
// password from the Employees flow. The user is forced to change their
// password on next login (must_change_password=true on users row).

const ADMIN_RESET_COPY = {
  en: {
    bandSubtitle: "Account update",
    subject: "VNDRLY — Your password was reset",
    greet: (name: string) => `Hi ${name},`,
    intro: (admin: string) =>
      `An administrator (<strong>${admin}</strong>) has reset your VNDRLY password. Use the temporary password below to sign in — you'll be asked to choose a new one right away.`,
    introText: (admin: string) =>
      `An administrator (${admin}) has reset your VNDRLY password. Use the temporary password below to sign in — you'll be asked to choose a new one right away.`,
    tempLabel: "Temporary password",
    note: "If you did not expect this email, please contact your administrator.",
  },
  es: {
    bandSubtitle: "Actualización de cuenta",
    subject: "VNDRLY — Se restableció su contraseña",
    greet: (name: string) => `Hola ${name},`,
    intro: (admin: string) =>
      `Un administrador (<strong>${admin}</strong>) restableció su contraseña de VNDRLY. Use la contraseña temporal a continuación para iniciar sesión — se le pedirá elegir una nueva de inmediato.`,
    introText: (admin: string) =>
      `Un administrador (${admin}) restableció su contraseña de VNDRLY. Use la contraseña temporal a continuación para iniciar sesión — se le pedirá elegir una nueva de inmediato.`,
    tempLabel: "Contraseña temporal",
    note:
      "Si no esperaba este correo, comuníquese con su administrador.",
  },
} as const;

export interface SendAdminResetPasswordEmailInput {
  to: string;
  displayName: string;
  adminDisplayName: string;
  tempPassword: string;
  locale?: EmailLocale;
}

export async function sendAdminResetPasswordEmail(
  input: SendAdminResetPasswordEmailInput,
): Promise<{ messageId: string | undefined }> {
  logger.debug({ fn: "sendAdminResetPasswordEmail" }, SKIP);
  return { messageId: undefined };
}

// ─── Bulk-action expiry warning email ──────────────────────────
//
// Sent to the actor of a QB account-mapping bulk-apply / CSV-import row
// when its retention window is about to close. Mirrors the visual style
// of the other system emails so it's recognisable as a VNDRLY notice
// and not mistaken for spam. The expiry-warning worker fires this once
// per row (deduped by the in-app notification dedupe key); a SendGrid
// outage logs a warning but does NOT block the in-app warning.

export interface SendBulkActionExpiringEmailInput {
  to: string;
  actorName: string;
  summary: string;
  kind: "bulk_apply" | "csv_import";
  daysRemaining: number;
  expiresAt: Date;
  retentionDays: number;
}

// Pure render function — extracted from sendBulkActionExpiringEmail so the
// notification-preferences "Preview email" affordance (Task #963) can show
// admins exactly what the worker would send without duplicating copy. Both
// the live send path and the preview route render through this function.
export function renderBulkActionExpiringEmail(
  input: Omit<SendBulkActionExpiringEmailInput, "to">,
): { subject: string; html: string; text: string } {
  const kindLabel = input.kind === "csv_import" ? "CSV import" : "bulk apply";
  const dayWord = input.daysRemaining === 1 ? "day" : "days";
  const subject = `Undo expires in ${input.daysRemaining} ${dayWord} — ${input.summary}`;
  const expiresOn = input.expiresAt.toLocaleString();
  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 540px; margin: 0 auto; padding: 24px; color: #111827;">
      <div style="background:#111827; color:#f59e0b; padding:16px 20px; border-radius:8px 8px 0 0;">
        <div style="font-weight:700; font-size:18px;">VNDRLY</div>
        <div style="color:#fef3c7; font-size:12px;">QuickBooks mapping — undo expiring</div>
      </div>
      <div style="border:1px solid #e5e7eb; border-top:0; padding:20px; border-radius:0 0 8px 8px;">
        <p>Hi ${escapeHtml(input.actorName)},</p>
        <p>Your <strong>${kindLabel}</strong> on QuickBooks account mappings &mdash; <em>${escapeHtml(input.summary)}</em> &mdash; falls out of the ${input.retentionDays}-day undo window in <strong>${input.daysRemaining} ${dayWord}</strong> (on <strong>${escapeHtml(expiresOn)}</strong>).</p>
        <p style="background:#fef3c7; padding:12px 16px; border-radius:6px; color:#92400e;">
          After that point the snapshot is pruned and this change can no longer be undone from the History dialog. Re-review it now if you want to roll it back.
        </p>
        <p style="color:#6b7280; font-size:12px; margin-top:24px;">Open <strong>Reports → QuickBooks mapping → History</strong> to find the row and undo it.</p>
        <p style="color:#9ca3af; font-size:12px;">— VNDRLY</p>
      </div>
    </div>`;
  const text =
    `Hi ${input.actorName},\n\n` +
    `Your ${kindLabel} on QuickBooks account mappings — "${input.summary}" — falls out of the ${input.retentionDays}-day undo window in ${input.daysRemaining} ${dayWord} (on ${expiresOn}).\n\n` +
    `After that point the snapshot is pruned and this change can no longer be undone from the History dialog. Re-review it now if you want to roll it back.\n\n` +
    `Open Reports → QuickBooks mapping → History to find the row and undo it.\n\n— VNDRLY`;
  return { subject, html, text };
}

export async function sendBulkActionExpiringEmail(
  input: SendBulkActionExpiringEmailInput,
): Promise<{ messageId: string | undefined }> {
  logger.debug({ fn: "sendBulkActionExpiringEmail" }, SKIP);
  return { messageId: undefined };
}

// ─────────────────────────────────────────────────────────────────
// Signup-assistant abuse digest
//
// Sent to platform admins by the signup-assistant digest worker
// (see `lib/signup-assistant-digest.ts`). Two flavours, distinguished
// by `reason`:
//   • `daily_summary` — once per UTC day at end-of-day, summarising
//     the day's volume and top source IPs even if nothing went wrong.
//   • `high_usage` — heads-up at the moment the daily budget passes
//     a configured threshold (default 75%) or the breaker trips,
//     throttled to once per hour so a saturated breaker doesn't
//     spam the inbox every tick.
//
// Recipients are de-duplicated, BCC'd so admins don't see each
// other's addresses, and English-only — these are operational
// notifications, not customer-facing copy. Returns null when the
// recipient list is empty (the digest worker calls with the already-
// filtered admin list, so this is a defensive guard).
// ─────────────────────────────────────────────────────────────────

export type SignupAssistantAbuseDigestReason = "daily_summary" | "high_usage";

export interface SignupAssistantAbuseDigestTopIp {
  ip: string;
  requests: number;
  dispatched: number;
}

export interface SendSignupAssistantAbuseDigestEmailInput {
  recipients: string[];
  reason: SignupAssistantAbuseDigestReason;
  dayKey: string;
  used: number;
  budget: number;
  totalRequests: number;
  ipBlocks: number;
  breakerTripped: number;
  uniqueIps: number;
  topIps: SignupAssistantAbuseDigestTopIp[];
  /** Direct link to the admin assistant-metrics page so the recipient
   *  can dig deeper. Optional — emails still send without it. */
  metricsUrl?: string | null;
}

export async function sendSignupAssistantAbuseDigestEmail(
  input: SendSignupAssistantAbuseDigestEmailInput,
): Promise<{ messageId: string | undefined } | null> {
  return null;
}

// ─── Awaiting payment weekly digest (Task #505) ─────────────────
//
// Sent to a partner's AP contacts once per week summarizing approved
// tickets that have been waiting more than N days for payment. The
// goal is to surface stuck disbursals to the people who actually cut
// checks, so they don't fall through the cracks. Body lists at most
// MAX_DIGEST_TICKET_LINES tickets in date-of-approval order; an
// overflow note links the partner straight to the filtered list when
// the queue exceeds that cap.

const AP_DIGEST_COPY = {
  en: {
    bandSubtitle: "Weekly AP digest",
    subject: (partner: string, count: number) =>
      `${partner} — ${count} ticket${count === 1 ? "" : "s"} awaiting payment`,
    greet: "Hi,",
    intro: (partner: string, count: number, days: number) =>
      `${count} approved ticket${count === 1 ? "" : "s"} for <strong>${partner}</strong> ${
        count === 1 ? "has" : "have"
      } been waiting more than ${days} day${days === 1 ? "" : "s"} for payment.`,
    introText: (partner: string, count: number, days: number) =>
      `${count} approved ticket${count === 1 ? "" : "s"} for ${partner} ${
        count === 1 ? "has" : "have"
      } been waiting more than ${days} day${days === 1 ? "" : "s"} for payment.`,
    totalLine: (total: string) => `Total awaiting payment: ${total}`,
    cta: "Open AP queue",
    closing:
      "Open the queue to disperse funds, or reply to this email if a ticket should be cancelled instead.",
    note: "You're receiving this because you're tagged as Accounts Payable on the partner contacts list.",
    headerTracking: "Tracking #",
    headerApproved: "Approved",
    headerDays: "Waiting",
    headerAmount: "Amount",
    overflow: (extra: number) =>
      `+${extra} more — open the AP queue to see the full list.`,
    daysAgo: (n: number) => `${n} day${n === 1 ? "" : "s"} ago`,
  },
  es: {
    bandSubtitle: "Resumen semanal de cuentas por pagar",
    subject: (partner: string, count: number) =>
      `${partner} — ${count} ticket${count === 1 ? "" : "s"} esperando pago`,
    greet: "Hola,",
    intro: (partner: string, count: number, days: number) =>
      `${count} ticket${count === 1 ? "" : "s"} aprobado${count === 1 ? "" : "s"} de <strong>${partner}</strong> lleva${
        count === 1 ? "" : "n"
      } más de ${days} día${days === 1 ? "" : "s"} esperando pago.`,
    introText: (partner: string, count: number, days: number) =>
      `${count} ticket${count === 1 ? "" : "s"} aprobado${count === 1 ? "" : "s"} de ${partner} lleva${
        count === 1 ? "" : "n"
      } más de ${days} día${days === 1 ? "" : "s"} esperando pago.`,
    totalLine: (total: string) => `Total pendiente: ${total}`,
    cta: "Abrir cola de cuentas por pagar",
    closing:
      "Abra la cola para liberar pagos, o responda este correo si algún ticket debe cancelarse.",
    note: "Recibe este correo porque está etiquetado como Cuentas por Pagar en los contactos del socio.",
    headerTracking: "Tracking #",
    headerApproved: "Aprobado",
    headerDays: "Esperando",
    headerAmount: "Monto",
    overflow: (extra: number) =>
      `+${extra} más — abra la cola para ver la lista completa.`,
    daysAgo: (n: number) => `Hace ${n} día${n === 1 ? "" : "s"}`,
  },
} as const;

export interface AwaitingPaymentDigestTicket {
  /** padded VNDRLY tracking #, e.g. "0042" */
  trackingNumber: string;
  /** ISO date string for "approved on", already locale-formatted upstream so this stays display-only here */
  approvedOnLabel: string;
  daysWaiting: number;
  /** pre-formatted, e.g. "$1,234.56" */
  amountLabel: string;
  /** absolute URL to the ticket detail page so the email links straight in */
  detailUrl: string;
}

export interface AwaitingPaymentDigestRecipient {
  email: string;
  locale?: EmailLocale;
}

export interface SendAwaitingPaymentDigestInput {
  recipients: AwaitingPaymentDigestRecipient[];
  partnerName: string;
  thresholdDays: number;
  totalAmountLabel: string;
  /** absolute URL of the partner's AP queue (filtered ticket list) */
  queueUrl: string;
  tickets: AwaitingPaymentDigestTicket[];
}

const MAX_DIGEST_TICKET_LINES = 25;

export async function sendAwaitingPaymentDigestEmail(
  input: SendAwaitingPaymentDigestInput,
): Promise<{ messageId: string | undefined } | null> {
  logger.debug({ fn: "sendAwaitingPaymentDigestEmail" }, SKIP);
  return { messageId: undefined };
}

// ─────────────────────────────────────────────────────────────────
// Scheduled "year-end 1099-K monthly breakout" email (Task #806).
//
// AP staff opt into this on the Reports page; a worker fans out the
// PDF (and optionally CSV) for the prior tax year on a cadence of
// weekly-in-January / monthly-otherwise. The email body is intentionally
// terse — the attachment is the deliverable, the body just frames it.
// Recipients are BCC'd so individual addresses on a shared distribution
// list are not exposed to each other.
// ─────────────────────────────────────────────────────────────────

export interface Dashboard1099MonthlyEmailAttachment {
  filename: string;
  type: string;
  contentBase64: string;
}

export interface SendDashboard1099MonthlyEmailInput {
  recipients: string[];
  scope: "admin" | "partner";
  scopeLabel: string;
  partnerName?: string;
  taxYear: number;
  cadence: "weekly" | "monthly";
  attachments: Dashboard1099MonthlyEmailAttachment[];
}

export async function sendDashboard1099MonthlyEmail(
  input: SendDashboard1099MonthlyEmailInput,
): Promise<{ messageId: string | undefined } | null> {
  logger.debug({ fn: "sendDashboard1099MonthlyEmail" }, SKIP);
  return { messageId: undefined };
}

// ─────────────────────────────────────────────────────────────────
// Payment-reversed notification (Task #862).
//
// Sent best-effort from POST /tickets/:id/reverse-funds-dispersal.
// The in-app notification (Task #504) is easy to miss and AP teams
// reconcile against email, so we fan a templated message out to the
// partner's "Accounts Payable" partner_contacts AND the vendor's
// primary billing contact (vendors.contact_email). All addresses are
// BCC'd so the partner AP distribution doesn't leak to the vendor and
// vice versa. Body carries the original payment metadata (method,
// reference, amount, date), the reversal reason, and the admin who
// performed the reversal so accounting has everything it needs to
// adjust the ledger without opening the app.
// ─────────────────────────────────────────────────────────────────

const PAYMENT_REVERSED_COPY = {
  en: {
    bandSubtitle: "Payment reversed",
    subject: (vendor: string, tracking: string) =>
      `Payment reversed — ${vendor} ticket #${tracking}`,
    greet: "Hi,",
    intro: (vendor: string, partner: string, tracking: string) =>
      `An admin reversed the payment that <strong>${partner}</strong> recorded against <strong>${vendor}</strong> ticket <strong>#${tracking}</strong>. The ticket is back in the AP queue and is no longer marked as paid.`,
    introText: (vendor: string, partner: string, tracking: string) =>
      `An admin reversed the payment that ${partner} recorded against ${vendor} ticket #${tracking}. The ticket is back in the AP queue and is no longer marked as paid.`,
    originalHeading: "Original payment",
    fieldMethod: "Method",
    fieldReference: "Reference",
    fieldAmount: "Amount",
    fieldDispersedOn: "Recorded on",
    reversalHeading: "Reversal details",
    fieldReversedBy: "Reversed by",
    fieldReversedAt: "Reversed at",
    fieldReason: "Reason",
    cta: "Open ticket",
    closing:
      "Please reverse the matching entry in your ledger and reach out if anything looks wrong.",
    note: "You're receiving this because you're tagged as Accounts Payable on the partner contacts list, or you're the vendor billing contact on file.",
    notRecorded: "—",
  },
  es: {
    bandSubtitle: "Pago revertido",
    subject: (vendor: string, tracking: string) =>
      `Pago revertido — ${vendor} ticket #${tracking}`,
    greet: "Hola,",
    intro: (vendor: string, partner: string, tracking: string) =>
      `Un administrador revirtió el pago que <strong>${partner}</strong> registró en el ticket <strong>#${tracking}</strong> de <strong>${vendor}</strong>. El ticket regresó a la cola de cuentas por pagar y ya no figura como pagado.`,
    introText: (vendor: string, partner: string, tracking: string) =>
      `Un administrador revirtió el pago que ${partner} registró en el ticket #${tracking} de ${vendor}. El ticket regresó a la cola de cuentas por pagar y ya no figura como pagado.`,
    originalHeading: "Pago original",
    fieldMethod: "Método",
    fieldReference: "Referencia",
    fieldAmount: "Monto",
    fieldDispersedOn: "Registrado el",
    reversalHeading: "Detalles de la reversión",
    fieldReversedBy: "Revertido por",
    fieldReversedAt: "Revertido el",
    fieldReason: "Motivo",
    cta: "Abrir ticket",
    closing:
      "Por favor reverse la entrada correspondiente en su libro mayor y contáctenos si algo no concuerda.",
    note: "Recibe este correo porque está etiquetado como Cuentas por Pagar en los contactos del socio, o es el contacto de facturación del proveedor.",
    notRecorded: "—",
  },
} as const;

export interface PaymentReversedRecipient {
  email: string;
  locale?: EmailLocale;
}

export interface SendPaymentReversedEmailInput {
  /** Partner-side AP recipients. Each gets a localized copy. */
  apRecipients: PaymentReversedRecipient[];
  /** Vendor's billing contact (vendors.contact_email). Optional — some
   *  vendors only have an in-app login and no on-file billing email. */
  vendorBillingEmail: string | null;
  vendorName: string;
  partnerName: string;
  /** Padded VNDRLY tracking #, e.g. "0042". */
  ticketTrackingNumber: string;
  /** Absolute URL to the ticket detail page. */
  ticketDetailUrl: string;
  /** Display name of the admin who performed the reversal. */
  reversedByName: string;
  /** When the reversal happened. Rendered with the recipient's locale. */
  reversedAt: Date;
  /** The non-empty reason captured from the reversal request body. */
  reason: string;
  /** Snapshot of the payment columns BEFORE the reversal cleared them. */
  originalPayment: {
    /** Raw payment_method enum, e.g. "check", "etf", "card". May be null on
     *  legacy rows that were dispersed before the column was non-null. */
    method: string | null;
    reference: string | null;
    /** Pre-formatted, e.g. "$1,234.56". Caller decides currency display. */
    amountLabel: string;
    /** When the original disperse-funds call ran. May be null on legacy
     *  rows where the column wasn't backfilled — we render "—" for the
     *  date in that case rather than skipping the field. */
    dispersedAt: Date | null;
  };
}

/** Cap recipient counts so a misconfigured AP distribution list can't
 *  blow past SendGrid's 1,000-address limit per request. The vendor email
 *  + AP contacts together rarely exceed a handful in practice. */
const MAX_PAYMENT_REVERSED_RECIPIENTS_PER_BATCH = 200;

export async function sendPaymentReversedEmail(
  input: SendPaymentReversedEmailInput,
): Promise<{ messageId: string | undefined } | null> {
  logger.debug({ fn: "sendPaymentReversedEmail" }, SKIP);
  return { messageId: undefined };
}

// ─────────────────────────────────────────────────────────────────
// Task #47 — Notification alert emails
//
// The notification rules engine + inline notify call sites historically
// only wrote in-app rows + fanned out mobile push. Users without the
// mobile app installed (or with the web tab closed) missed time-sensitive
// alerts like ticket kickbacks, expiring certifications, and Hotlist
// awards. These two helpers add the third channel:
//
//   • `sendNotificationAlertEmail` — single, polished email per alert.
//     Used for high-priority types (kickback / cert expired / job
//     awarded) and for any alert when the recipient does NOT have the
//     daily-digest preference enabled.
//
//   • `sendNotificationDigestEmail` — once-per-day rollup of all the
//     low-priority alerts the recipient accumulated. Sent by the
//     notification-email-digest worker so users who opt in don't get
//     spammed by chatty categories like "ticket note added".
//
// Both helpers expand the in-app `link` (which is always app-relative,
// e.g. `/tickets/1234`) into an absolute URL using `APP_BASE_URL`. If
// `APP_BASE_URL` is not configured the email still sends, the deep link
// just degrades to plain text.
// ─────────────────────────────────────────────────────────────────

const NOTIFICATION_CATEGORY_LABELS: Record<string, string> = {
  tickets: "Tickets",
  hotlist: "Hotlist",
  compliance: "Compliance",
  crew: "Crew",
  system: "System",
  visitor: "Visitors",
  // Task #50 — instant @mention emails route through `sendNotificationAlertEmail`,
  // which calls `notificationCategoryLabel` for the section header.
  comments: "Comments",
};

function notificationCategoryLabel(category: string): string {
  return NOTIFICATION_CATEGORY_LABELS[category] ?? "Notifications";
}

/** Resolve an in-app `link` (typically `/tickets/123`) to an absolute
 *  URL the email recipient can click. Returns null when no app base URL
 *  is configured so callers can render a plain "Open VNDRLY" line that
 *  still makes sense in inboxes that strip raw paths. */
export function buildNotificationDeepLink(link: string | null | undefined): string | null {
  if (!link) return null;
  // Already absolute (someone passed a full URL through `notif.link`).
  if (/^https?:\/\//i.test(link)) return link;
  const raw = process.env.APP_BASE_URL?.trim();
  if (!raw) return null;
  const base = raw.replace(/\/+$/, "");
  const path = link.startsWith("/") ? link : `/${link}`;
  return `${base}${path}`;
}

export interface SendNotificationAlertEmailInput {
  to: string;
  recipientName?: string | null;
  category: string;
  /** The notification `type` (e.g. `ticket_kicked_back`). Used only for
   *  the subject line tag so different alert types are easy to scan in
   *  an inbox. */
  type: string;
  title: string;
  body?: string | null;
  /** App-relative path or absolute URL. Resolved via `APP_BASE_URL`. */
  link?: string | null;
  /** When true the recipient is being told this is a high-priority
   *  alert; we surface a small badge in the email header. */
  highPriority?: boolean;
}

export async function sendNotificationAlertEmail(
  input: SendNotificationAlertEmailInput,
): Promise<{ messageId: string | undefined }> {
  logger.debug({ fn: "sendNotificationAlertEmail" }, SKIP);
  return { messageId: undefined };
}

export interface NotificationDigestItem {
  category: string;
  title: string;
  body?: string | null;
  link?: string | null;
  createdAt: Date;
}

export interface SendNotificationDigestEmailInput {
  to: string;
  recipientName?: string | null;
  /** Calendar day the digest covers, formatted for the recipient's
   *  locale by the worker (e.g. "May 1, 2026"). Surfaced verbatim in
   *  the subject + intro line. */
  dayLabel: string;
  items: NotificationDigestItem[];
}

export async function sendNotificationDigestEmail(
  input: SendNotificationDigestEmailInput,
): Promise<{ messageId: string | undefined } | null> {
  logger.debug({ fn: "sendNotificationDigestEmail" }, SKIP);
  return { messageId: undefined };
}


// ─────────────────────────────────────────────────────────────────
// Certification expiration reminders (Task #45).
//
// Daily worker scans active employee certifications and emails
// vendors / admins when a cert is approaching its expiration_date at
// 60 / 30 / 7 day thresholds. Vendors get a digest of just their own
// employees' upcoming expirations; admins receive a global view
// covering every vendor with at least one new trigger this run.
// ─────────────────────────────────────────────────────────────────

export interface CertExpirationDigestRow {
  /** Field employee display name, "First Last" */
  employeeName: string;
  /** Vendor that employs this person (admin digest spans many vendors;
   *  the vendor digest sets all rows to the same name). */
  vendorName: string;
  certName: string;
  /** Optional, e.g. "OSHA 10". Rendered when present. */
  certIssuer: string | null;
  /** ISO date (YYYY-MM-DD) of the expiration. Pre-formatted for
   *  display by the caller so the email helper stays presentational. */
  expirationDateLabel: string;
  /** 60 | 30 | 7. Used to color the row by urgency. */
  daysUntilExpiration: number;
  /** Absolute URL to the employee's detail page. The certifications
   *  section is the page's main content so a plain employee link
   *  satisfies the task's "links back to the employee's certifications
   *  section" requirement. */
  detailUrl: string;
}

export interface SendCertExpirationVendorDigestInput {
  /** All recipients receive the same body; we BCC them so individual
   *  addresses on a vendor distribution list aren't exposed. */
  recipients: string[];
  vendorName: string;
  rows: CertExpirationDigestRow[];
}

export interface SendCertExpirationAdminDigestInput {
  recipients: string[];
  rows: CertExpirationDigestRow[];
  /** Number of distinct vendors covered. Echoed in the subject so
   *  admins can gauge scope at a glance. */
  vendorCount: number;
}

const MAX_CERT_DIGEST_ROWS = 100;

function urgencyColor(days: number): string {
  if (days <= 7) return "#b91c1c"; // red-700
  if (days <= 30) return "#b45309"; // amber-700
  return "#1f2937"; // gray-800 (60d)
}

function urgencyLabel(days: number): string {
  if (days === 1) return "1 day left";
  return `${days} days left`;
}

function renderCertDigestRows(
  rows: CertExpirationDigestRow[],
  showVendor: boolean,
): { html: string; text: string; overflow: number } {
  const visible = rows.slice(0, MAX_CERT_DIGEST_ROWS);
  const overflow = rows.length - visible.length;
  const headerCells = [
    "Employee",
    showVendor ? "Vendor" : null,
    "Certification",
    "Expires",
    "Status",
  ].filter((s): s is string => s !== null);
  const headerHtml = headerCells
    .map(
      (h) =>
        `<th style="padding:6px 12px 6px 0;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;text-align:left;">${escapeHtml(
          h,
        )}</th>`,
    )
    .join("");
  const bodyHtml = visible
    .map((r) => {
      const color = urgencyColor(r.daysUntilExpiration);
      const certText =
        r.certIssuer && r.certIssuer.trim()
          ? `${r.certName} <span style="color:#6b7280;">(${escapeHtml(
              r.certIssuer,
            )})</span>`
          : escapeHtml(r.certName);
      const cells = [
        `<td style="padding:6px 12px 6px 0;color:#111827;"><a href="${
          r.detailUrl
        }" style="color:#1d4ed8;text-decoration:none;">${escapeHtml(
          r.employeeName,
        )}</a></td>`,
        showVendor
          ? `<td style="padding:6px 12px 6px 0;color:#374151;">${escapeHtml(
              r.vendorName,
            )}</td>`
          : null,
        `<td style="padding:6px 12px 6px 0;color:#111827;">${certText}</td>`,
        `<td style="padding:6px 12px 6px 0;color:#374151;">${escapeHtml(
          r.expirationDateLabel,
        )}</td>`,
        `<td style="padding:6px 0;color:${color};font-weight:600;">${escapeHtml(
          urgencyLabel(r.daysUntilExpiration),
        )}</td>`,
      ].filter((s): s is string => s !== null);
      return `<tr>${cells.join("")}</tr>`;
    })
    .join("");
  const html = `<table style="border-collapse:collapse;font-size:14px;width:100%;">
    <thead><tr>${headerHtml}</tr></thead>
    <tbody>${bodyHtml}</tbody>
  </table>`;
  const textLines = visible.map((r) => {
    const left = showVendor
      ? `  ${r.employeeName} (${r.vendorName})`
      : `  ${r.employeeName}`;
    const cert = r.certIssuer
      ? `${r.certName} (${r.certIssuer})`
      : r.certName;
    return `${left}  -  ${cert}  -  expires ${r.expirationDateLabel}  (${urgencyLabel(
      r.daysUntilExpiration,
    )})\n  ${r.detailUrl}`;
  });
  const text = textLines.join("\n");
  return { html, text, overflow };
}

export async function sendCertExpirationVendorDigestEmail(
  input: SendCertExpirationVendorDigestInput,
): Promise<{ messageId: string | undefined } | null> {
  logger.debug({ fn: "sendCertExpirationVendorDigestEmail" }, SKIP);
  return { messageId: undefined };
}

export async function sendCertExpirationAdminDigestEmail(
  input: SendCertExpirationAdminDigestInput,
): Promise<{ messageId: string | undefined } | null> {
  logger.debug({ fn: "sendCertExpirationAdminDigestEmail" }, SKIP);
  return { messageId: undefined };
}

// ─────────────────────────────────────────────────────────────────
// OpenAccountant connection reminder — Task #248
// Sent by the daily oa-connection-reminder-worker when an OA
// connection has been revoked or appears to have a stale OAuth
// refresh. The connection's creator is the primary recipient (they
// installed the credentials); vendor admins also receive the in-app
// notification via the worker's notifyUsers fan-out.
export interface SendOaConnectionReminderInput {
  to: string;
  recipientName: string | null;
  vendorName: string;
  /** Display label of the connection (display_name or fallback). */
  connectionLabel: string;
  reason: "revoked" | "expiring_soon";
  /** Lookahead window the worker uses to decide a token is approaching expiry. */
  expiringSoonWindowDays: number;
  /** "No recent refresh" gate paired with `expiringSoonWindowDays`. */
  staleRefreshDays: number;
  /** Deep link back to the Reports page where the user reconnects. */
  reportsUrl: string;
}

export async function sendOaConnectionReminderEmail(
  input: SendOaConnectionReminderInput,
): Promise<{ messageId: string | undefined }> {
  logger.debug({ fn: "sendOaConnectionReminderEmail" }, SKIP);
  return { messageId: undefined };
}

// ─────────────────────────────────────────────────────────────────
// Comment-thread reply digest — Task #50
//
// `comment_added` and `hotlist_comment_added` notifications fire when a
// non-mentioned participant on a ticket/hotlist gets a new comment.
// Emailing one per reply spams the inbox on chatty threads, so the
// `comment-reply-digest` worker batches them every few minutes and
// hands the per-user roll-up to this helper.
//
// Mentions go through `sendNotificationAlertEmail` instead — this
// helper only handles the batched reply path.
// ─────────────────────────────────────────────────────────────────

export interface CommentReplyDigestItem {
  /** "ticket" or "hotlist" — used to label the section header so a
   *  reader can tell where the reply happened at a glance. */
  source: "ticket" | "hotlist";
  /** Free-form heading for the thread (e.g. "Tracking #0123" or
   *  "Hotlist job — Acme Refinery"). The worker builds this from the
   *  notification title to avoid a second DB lookup. */
  threadLabel: string;
  /** A short preview of the comment body. */
  body: string | null;
  /** Already-formatted "Jane Doe replied" line, taken from the
   *  notification title. */
  authorLine: string;
  /** App-relative deep link (e.g. /tickets/123#comment-456) that
   *  opens the thread anchored at the new reply. Resolved via
   *  APP_BASE_URL by `buildNotificationDeepLink`. */
  link: string | null;
  createdAt: Date;
}

export interface SendCommentReplyDigestEmailInput {
  to: string;
  recipientName?: string | null;
  items: CommentReplyDigestItem[];
}

export async function sendCommentReplyDigestEmail(
  input: SendCommentReplyDigestEmailInput,
): Promise<{ messageId: string | undefined } | null> {
  logger.debug({ fn: "sendCommentReplyDigestEmail" }, SKIP);
  return { messageId: undefined };
}
