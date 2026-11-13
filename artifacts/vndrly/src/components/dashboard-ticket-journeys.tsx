import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { Check, ChevronRight, Circle, Clock, Route } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { PngPillButton } from "@/components/png-pill-rollover";
import { journeyCategories, journeyCategory, partitionTicketJourneys, type JourneyTicket } from "@/lib/ticket-journey";
import "./dashboard-ticket-journeys.css";

const base = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;
async function read<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`${base}${path}`, { credentials: "include", signal });
  if (!response.ok) throw new Error("Unable to load ticket journey");
  return response.json();
}
type Event = { id: number; status: string; reason: string | null; at: string; actor: string | null };
type Invoice = { id: number; number: string; status: string; total: string; balanceDue: string; paidAmount: string; ticketCount: number;
  payments: { id: number; amount: string; date: string; method: string; reference: string | null; notes: string | null }[] };
type Detail = { history: Event[]; invoices: Invoice[]; canRecordPayment: boolean;
  approvals: { order: number; approver: string; decision: string | null; comment: string | null; at: string | null }[] };

export function DashboardTicketJourneys({ scope, enabled }: { scope: string; enabled: boolean }) {
  const { t } = useTranslation();
  const query = useQuery({ queryKey: ["ticket-journeys", scope], enabled, staleTime: 30_000,
    queryFn: ({ signal }) => read<{ tickets: JourneyTicket[] }>("/dashboard/ticket-journeys", signal) });
  const { open, history } = partitionTicketJourneys(query.data?.tickets ?? []);
  const [selected, setSelected] = useState<number | null>(null);
  const rows = (tickets: JourneyTicket[]) => tickets.map(ticket => <TicketRow key={ticket.id} ticket={ticket}
    scope={scope} selected={selected === ticket.id} select={() => setSelected(selected === ticket.id ? null : ticket.id)} />);
  return <Card className="ticket-journeys" data-testid="card-ticket-stats">
    <CardHeader><CardTitle><Route aria-hidden="true" />{t("dashboard.trackingStatus")}</CardTitle></CardHeader>
    <CardContent>
      {!enabled ? <p role="status">{t("ticketJourney.paused")}</p> : query.isPending ? <p role="status">{t("ticketJourney.loading")}</p>
        : query.isError ? <div role="alert">{t("ticketJourney.error")} <PngPillButton color="blue" onClick={() => void query.refetch()}>{t("ticketJourney.retry")}</PngPillButton></div>
        : <>
          <h3>{t("ticketJourney.open")} <span>{open.length}</span></h3>
          {journeyCategories.map(category => {
            const tickets = open.filter(ticket => journeyCategory(ticket) === category);
            if (category === "other" && !tickets.length) return null;
            return <details key={category} className="journey-category">
              <summary><ChevronRight aria-hidden="true" /><span>{t(`ticketJourney.categories.${category}`)}</span><b>{tickets.length}</b></summary>
              {tickets.length ? rows(tickets) : <p className="journey-muted">{t("ticketJourney.empty")}</p>}
            </details>;
          })}
          <details className="journey-category journey-history"><summary><ChevronRight aria-hidden="true" /><span>{t("ticketJourney.history")}</span><b>{history.length}</b></summary>
            {history.length ? rows(history) : <p className="journey-muted">{t("ticketJourney.noHistory")}</p>}
          </details>
        </>}
    </CardContent>
  </Card>;
}

function TicketRow({ ticket, scope, selected, select }: { ticket: JourneyTicket; scope: string; selected: boolean; select: () => void }) {
  const { t, i18n } = useTranslation();
  const detail = useQuery({ queryKey: ["ticket-journey", scope, ticket.id], enabled: selected, staleTime: 15_000,
    queryFn: ({ signal }) => read<Detail>(`/dashboard/ticket-journeys/${ticket.id}`, signal) });
  const date = (at: string) => new Date(at).toLocaleString(i18n.language);
  const events = detail.data?.history ?? [];
  const event = (statuses: string[]) => [...events].reverse().find(row => statuses.includes(row.status));
  const currentStep = ticket.status === "awaiting_acceptance" ? "offered"
    : ["initiated", "draft"].includes(ticket.status) ? "accepted"
      : ticket.status === "in_progress" ? "working" : "submitted";
  const steps = [
    { key: "offered", event: event(["awaiting_acceptance"]) },
    { key: "accepted", event: event(["initiated"]) },
    { key: "working", event: event(["in_progress"]) },
    { key: "submitted", event: event(["submitted"]) },
  ];
  return <div className="journey-ticket">
    <button type="button" className="journey-ticket-toggle" aria-expanded={selected} aria-controls={`journey-${ticket.id}`} onClick={select}>
      <ChevronRight aria-hidden="true" /><span><strong>#{ticket.id} · {ticket.siteName}</strong><small>{ticket.partnerName}</small>
        <small>{ticket.paid ? t("ticketJourney.paid") : t(`ticketStatus.${ticket.status}`, { defaultValue: ticket.status.replaceAll("_", " ") })}</small></span>
    </button>
    {selected && <div id={`journey-${ticket.id}`} className="journey-expanded">
      {detail.isPending ? <p role="status">{t("ticketJourney.loading")}</p> : detail.isError ? <p role="alert">{t("ticketJourney.error")} <button onClick={() => void detail.refetch()}>{t("ticketJourney.retry")}</button></p> : <>
        <ol className="journey-steps">
          {steps.map(step => <li key={step.key} data-complete={!!step.event} data-current={!ticket.paid && !ticket.approvedAt && step.key === currentStep}>
            {step.event ? <Check aria-hidden="true" /> : <Circle aria-hidden="true" />}<div><strong>{t(`ticketJourney.steps.${step.key}`)}</strong>
              <small>{step.event ? `${date(step.event.at)} · ${step.event.actor ?? t("ticketJourney.system")}` : t("ticketJourney.notRecorded")}</small></div>
          </li>)}
          {detail.data!.approvals.length ? detail.data!.approvals.map((step, index) => <li key={`${step.order}-${index}`} data-complete={step.decision === "approved"}>
            {step.decision === "approved" ? <Check aria-hidden="true" /> : <Clock aria-hidden="true" />}<div><strong>{step.approver}</strong>
              <small>{step.decision ?? t("ticketJourney.pending")}{step.at ? ` · ${date(step.at)}` : ""}</small>{step.comment && <small>{step.comment}</small>}</div>
          </li>) : <li><Circle aria-hidden="true" /><div><strong>{t("ticketJourney.steps.landman")}</strong><small>{t("ticketJourney.noSeparateReview")}</small></div></li>}
          <li data-complete={!!ticket.approvedAt}><>{ticket.approvedAt ? <Check aria-hidden="true" /> : <Clock aria-hidden="true" />}</><div>
            <strong>{t("ticketJourney.steps.finance")}</strong><small>{ticket.approvedAt ? date(ticket.approvedAt) : t("ticketJourney.pending")}</small></div></li>
          <li data-complete={ticket.paid}>{ticket.paid ? <Check aria-hidden="true" /> : <Circle aria-hidden="true" />}<div><strong>{t("ticketJourney.paid")}</strong>
            <small>{ticket.paid ? (ticket.finishedAt ? date(ticket.finishedAt) : t("ticketJourney.recorded")) : Number(ticket.paidAmount) > 0 ? t("ticketJourney.partial") : t("ticketJourney.pending")}</small></div></li>
        </ol>
        {ticket.kickbackReason && <p className="journey-exception">{t("ticketJourney.kickback")}: {ticket.kickbackReason}</p>}
        <Link href={`/tickets/${ticket.id}`} className="journey-link">{t("ticketJourney.openTicket")}</Link>
        <details className="journey-events"><summary>{t("ticketJourney.events")}</summary>{events.map(row => <p key={row.id}>{date(row.at)} · {row.actor ?? t("ticketJourney.system")} · {row.status.replaceAll("_", " ")}{row.reason && ` — ${row.reason}`}</p>)}</details>
        {detail.data!.invoices.map(invoice => <InvoicePayment key={invoice.id} invoice={invoice} ticket={ticket} canPay={detail.data!.canRecordPayment} />)}
        {!detail.data!.invoices.length && <p className="journey-muted">{t("ticketJourney.paymentAfterInvoice")}</p>}
      </>}
    </div>}
  </div>;
}

function InvoicePayment({ invoice, ticket, canPay }: { invoice: Invoice; ticket: JourneyTicket; canPay: boolean }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [method, setMethod] = useState("ach");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const mutation = useMutation({ mutationFn: async () => {
    const response = await fetch(`${base}/invoices/${invoice.id}/payments`, { method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount, paidAt, method, referenceNumber: reference, notes }) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? t("ticketJourney.paymentFailed"));
    return body;
  }, onSuccess: async () => {
    setAmount(""); setReference(""); setNotes("");
    await Promise.all([qc.invalidateQueries({ queryKey: ["ticket-journeys"] }), qc.invalidateQueries({ queryKey: ["ticket-journey"] }),
      qc.invalidateQueries({ queryKey: ["invoices"] }), qc.invalidateQueries({ queryKey: ["dashboard-ticket-panels"] })]);
  } });
  const money = (value: string) => new Intl.NumberFormat(i18n.language, { style: "currency", currency: "USD" }).format(Number(value));
  const eligible = canPay && ["approved", "awaiting_payment", "funds_dispersed"].includes(ticket.status) && !["draft", "cancelled", "paid"].includes(invoice.status) && Number(invoice.balanceDue) > 0;
  return <section className="journey-payment">
    <h4>{t("ticketJourney.recordPayment")}</h4>
    <Link href={`/invoices/${invoice.id}`} className="journey-link">{t("ticketJourney.invoice")} {invoice.number}</Link>
    <p>{t("ticketJourney.received")}: {money(invoice.paidAmount)} · {t("ticketJourney.balance")}: {money(invoice.balanceDue)}</p>
    {invoice.ticketCount > 1 && <p className="journey-muted">{t("ticketJourney.sharedInvoice", { count: invoice.ticketCount })}</p>}
    {invoice.payments.map(payment => <p key={payment.id}>{money(payment.amount)} · {new Date(payment.date).toLocaleDateString(i18n.language)} · {payment.method} {payment.reference}{payment.notes && ` · ${payment.notes}`}</p>)}
    {eligible ? <form onSubmit={event => { event.preventDefault(); if (!mutation.isPending) mutation.mutate(); }}>
      <label>{t("ticketJourney.amount")}<input required inputMode="decimal" type="number" min="0.01" max={invoice.balanceDue} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></label>
      <label>{t("ticketJourney.date")}<input required type="date" value={paidAt} onChange={e => setPaidAt(e.target.value)} /></label>
      <label>{t("ticketJourney.method")}<select value={method} onChange={e => setMethod(e.target.value)}>{["ach", "check", "wire", "cash", "credit_card", "other"].map(value => <option key={value} value={value}>{t(`ticketJourney.methods.${value}`)}</option>)}</select></label>
      <label>{t("ticketJourney.reference")}<input maxLength={120} value={reference} onChange={e => setReference(e.target.value)} /></label>
      <label>{t("ticketJourney.notes")}<textarea maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)} /></label>
      <p className="journey-muted">{t("ticketJourney.noTransfer")}</p>
      <PngPillButton type="submit" color="green" disabled={mutation.isPending}>{mutation.isPending ? t("ticketJourney.saving") : t("ticketJourney.recordPayment")}</PngPillButton>
      {mutation.isError && <p role="alert">{mutation.error.message}</p>}{mutation.isSuccess && <p role="status">{t("ticketJourney.saved")}</p>}
    </form> : <p className="journey-muted">{invoice.status === "draft" ? t("ticketJourney.draftInvoice") : !canPay ? t("ticketJourney.vendorOnly") : ticket.paid ? t("ticketJourney.paid") : t("ticketJourney.paymentAfterApproval")}</p>}
  </section>;
}
