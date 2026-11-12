import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import {
  createGateDailyBillingWorkflow,
  gateDailyBillingCopy,
  gateDailyBillingError,
  fleetInstantToWallTime,
  type GateBillingRequest,
  type GateBillingWorkflowSnapshot,
} from "@workspace/api-zod";
import { PngPillButton } from "@/components/png-pill-rollover";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { BrandedCheckbox } from "@/components/branded-checkbox";
import { formatTicketTrackingNumber } from "@workspace/db/format";
import { GateTicketProfitability, gateGoDemoCosts } from "@/components/gate-ticket-profitability";
import { calculateTicketEstimate, GateTicketEstimate, type TicketEstimate } from "@/components/gate-ticket-estimate";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
const base = import.meta.env.BASE_URL.replace(/\/$/, "");
const defaultRequest: GateBillingRequest = async (path, init) => {
  const response = await fetch(`${base}/api${path}`, {
      ...init,
      credentials: "include",
    }),
    body = await response.json().catch(() => null);
  if (!response.ok)
    throw Object.assign(new Error("Billing request failed"), {
      status: response.status,
      code: body?.code,
    });
  return body;
};
const miniCard = "min-h-11 rounded-lg border border-[var(--brand-primary)] bg-[#2b2b2f] px-3 text-sm text-[#ececec] disabled:border-[#55555a] disabled:text-[#a3a3a3]";
const ticketAction = "min-h-6 whitespace-nowrap rounded-sm border-0 bg-transparent p-0 text-xs text-[var(--brand-primary)] no-underline enabled:cursor-pointer enabled:hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)] disabled:text-[#a3a3a3]";
type BillingTicketRow = {
  id: number;
  estimate?: TicketEstimate | null;
  group: "unstarted" | "open" | "closed";
  tone: "white" | "blue" | "amber" | "red" | "green";
  status: string;
  invoiceCents: number;
  revenueByDay?: { day: string; chargeCents: number }[];
  quarterCents: number;
  yearToDateCents: number;
  payrollCents: number | null;
  quarterPayrollCents: number;
  yearToDatePayrollCents: number;
  daysSinceBilled: number;
  siteName: string;
  gateName: string | null;
  stationId: string | null;
  jobOfferId: number | null;
  workTypeId: number;
  serviceName: string | null;
};
const ticketColors = {
  white: "#ececec", blue: "#7dd3fc", amber: "#fbbf24", red: "#fca5a5", green: "#86efac",
};
const ticketLists = [
  { group: "unstarted", label: "You have {count} tickets waiting to start", singular: "You have 1 ticket waiting to start" },
  { group: "open", label: "You have {count} tickets open", singular: "You have 1 ticket open" },
  { group: "closed", label: "You have {count} tickets closed", singular: "You have 1 ticket closed" },
] as const;
const empty: GateBillingWorkflowSnapshot = {
  busy: true,
  posts: [],
  nextCursor: null,
  postId: "",
  setup: null,
  preview: null,
  pending: null,
  result: null,
  errorCode: null,
};
export default function GateDailyBillingPanel({
  scopeKey,
  request = defaultRequest,
  dashboardPostId,
  showGateGoDemo = false,
}: {
  scopeKey: string;
  request?: GateBillingRequest;
  dashboardPostId?: string;
  showGateGoDemo?: boolean;
}) {
  return <ScopedPanel key={`${scopeKey}:${dashboardPostId ?? ""}`} request={request} dashboardPostId={dashboardPostId} showGateGoDemo={showGateGoDemo} />;
}
function ScopedPanel({ request, dashboardPostId, showGateGoDemo }: { request: GateBillingRequest; dashboardPostId?: string; showGateGoDemo: boolean }) {
  const { i18n } = useTranslation(),
    copy = (text: string) => gateDailyBillingCopy(text, i18n.language),
    [scopeError, setScopeError] = useState<string | null>(null),
    [workflow, setWorkflow] = useState<ReturnType<
      typeof createGateDailyBillingWorkflow
    > | null>(null);
  useEffect(() => {
    const value = createGateDailyBillingWorkflow({
      request,
      operationId: () => crypto.randomUUID(),
    });
    setWorkflow(value);
    if (!dashboardPostId) void value.load();
    return () => value.dispose();
  }, [request, dashboardPostId]);
  const state = useSyncExternalStore(
      workflow?.subscribe ?? (() => () => {}),
      workflow?.getSnapshot ?? (() => empty),
      () => empty,
    ),
    config = state.setup?.config,
    locked = state.busy || Boolean(state.pending),
    frozen = Boolean(config?.openTicketId);
  const [tickets, setTickets] = useState<BillingTicketRow[] | null>(null);
  const [editing, setEditing] = useState<BillingTicketRow | null>(null);
  const [reviewing, setReviewing] = useState<BillingTicketRow | null>(null);
  const [inventoryError, setInventoryError] = useState(false);
  useEffect(() => {
    if (!dashboardPostId) return;
    let active = true;
    void request("/gate-billing/tickets").then(
      (rows) => {
        if (active) {
          setTickets(rows as BillingTicketRow[]);
          setInventoryError(false);
        }
      },
      () => { if (active) setInventoryError(true); },
    );
    return () => { active = false; };
  }, [dashboardPostId, request, state.result, config?.version]);
  const [service, setService] = useState(""),
    [start, setStart] = useState(""),
    [rule, setRule] = useState<"full_day" | "prorate_actual_day">("full_day"),
    [automatic, setAutomatic] = useState(false),
    [interval, setIntervalDays] = useState("30"),
    [continueBilling, setContinue] = useState(true),
    [dialogAction, setDialogAction] = useState<"start" | "invoice" | "end" | null>(null),
    [selectedTicket, setSelectedTicket] = useState<BillingTicketRow | null>(null),
    [opening, setOpening] = useState(false);
  const openTicketAction = async (ticket: BillingTicketRow, action: "start" | "invoice" | "end") => {
    if (!ticket.stationId || !workflow || opening || state.busy) return;
    if (state.pending) {
      if (selectedTicket?.id === ticket.id) setDialogAction(action);
      return;
    }
    setOpening(true);
    setScopeError(null);
    try {
      const scope = await request(`/gate-billing/${ticket.stationId}/scope`) as { stationId: string };
      await workflow.select(scope.stationId);
      const next = workflow.getSnapshot();
      if (next.errorCode || !next.setup) throw { code: next.errorCode };
      if (action === "start"
        ? next.setup.config?.openTicketId || !next.setup.services.some(item => item.id === ticket.workTypeId && item.jobOfferId === ticket.jobOfferId)
        : next.setup.config?.openTicketId !== ticket.id) throw { code: "gate_billing.ticket_review_required" };
      setSelectedTicket(ticket);
      setDialogAction(action);
    } catch (error) {
      setScopeError((error as { code?: string })?.code ?? "gate_billing.response_unconfirmed");
    } finally {
      setOpening(false);
    }
  };
  const selectedService = dialogAction === "start" && selectedTicket
    ? `${selectedTicket.workTypeId}:${selectedTicket.jobOfferId}`
    : service;
  useEffect(() => {
    const value = state.setup?.config;
    setService(
      value
        ? `${value.workTypeId}:${value.jobOfferId ?? "legacy"}`
        : state.setup?.services.length === 1
          ? `${state.setup.services[0].id}:${state.setup.services[0].jobOfferId ?? "legacy"}`
          : "",
    );
    setStart(
      value?.periodStartDay ??
        fleetInstantToWallTime(
          new Date().toISOString(),
          "America/Chicago",
        )!.slice(0, 10),
    );
    setRule(value?.partialDayRule ?? "full_day");
    setAutomatic(
      value?.autoInvoiceEveryDays !== null &&
        value?.autoInvoiceEveryDays !== undefined,
    );
    setIntervalDays(String(value?.autoInvoiceEveryDays ?? 30));
    setContinue(true);
  }, [state.setup]);
  const money = (cents: number) =>
      new Intl.NumberFormat(i18n.language, {
        style: "currency",
        currency: "USD",
      }).format(cents / 100),
    field =
      "w-full rounded-xl border-2 border-[var(--brand-primary)] bg-card px-3 py-2 text-card-foreground",
    card = dashboardPostId
      ? "space-y-4 rounded-[14px] border border-[var(--brand-primary)] bg-[#242426] p-4 text-[#ececec]"
      : "space-y-4 rounded-xl border-2 border-[var(--brand-primary)] bg-card p-4 text-card-foreground";
  const save = () =>
    void workflow?.configure({
      workTypeId: Number(selectedService.split(":")[0]),
      ...(selectedService.split(":")[1] !== "legacy" ? { jobOfferId: Number(selectedService.split(":")[1]) } : {}),
      ...(dialogAction === "start" && selectedTicket ? { ticketId: selectedTicket.id } : {}),
      startDay: start,
      partialDayRule: dashboardPostId ? "full_day" : rule,
      autoInvoiceEveryDays: automatic ? Number(interval) : null,
    });
  const content = (
    <div className="space-y-4" aria-busy={state.busy}>
      <section className={card}>
        <p>
          {copy(
            "Staff shifts and Gate coverage continue independently of billing.",
          )}
        </p>
        <p>{copy("Billing includes only completed days in Central time.")}</p>
        {!dashboardPostId && <label className="block space-y-1">
          <span>{copy("Gate post")}</span>
          <select
            aria-label={copy("Gate post")}
            className={field}
            value={state.postId}
            disabled={locked}
            onChange={(event) => void workflow?.select(event.target.value)}
          >
            <option value="">{copy("Choose a post")}</option>
            {state.posts.map((post) => (
              <option key={post.id} value={post.id}>
                {post.siteName} — {post.name}
              </option>
            ))}
          </select>
        </label>}
        {state.nextCursor ? (
          <PngPillButton
            disabled={locked}
            onClick={() => void workflow?.load(state.nextCursor!)}
          >
            {copy("Load more posts")}
          </PngPillButton>
        ) : null}
        {!state.busy && !dashboardPostId && !state.posts.length && !state.errorCode ? (
          <p>{copy("No authorized gate posts.")}</p>
        ) : null}
        {state.busy ? <p role="status">{copy("Working…")}</p> : null}
        {state.errorCode ? (
          <p role="alert">
            {gateDailyBillingError(state.errorCode, i18n.language)}
          </p>
        ) : null}
        {state.pending ? (
          <PngPillButton
            disabled={state.busy}
            onClick={() => void workflow?.retry()}
          >
            {copy("Retry request")}
          </PngPillButton>
        ) : null}
      </section>
      {state.setup?.automationNotice ? (
        <p role="alert">{copy("Automatic billing needs office review.")}</p>
      ) : null}
      {state.setup && (!dashboardPostId || !frozen) ? (
        <section className={card}>
          <div className="space-y-1">
            <span>{copy("Approved daily service")}</span>
            {dashboardPostId ? (
              <Select value={selectedService} disabled={locked || frozen} onValueChange={setService}>
                <SelectTrigger aria-label={copy("Approved daily service")} className="min-h-11 rounded-full border-[var(--brand-primary)] bg-[#303034] text-[#ececec] [&>svg]:shrink-0 [&>svg]:text-[var(--brand-primary)] [&>svg]:opacity-100">
                  <SelectValue placeholder={copy("Choose an approved service")} />
                </SelectTrigger>
                <SelectContent position="popper" className="w-[var(--radix-select-trigger-width)] border-[var(--brand-primary)] bg-[#242426] text-[#ececec]">
                  {state.setup.services.filter(item => !selectedTicket || item.jobOfferId === selectedTicket.jobOfferId && item.id === selectedTicket.workTypeId).map((item) => (
                    <SelectItem key={`${item.id}:${item.jobOfferId ?? "legacy"}`}
                      value={`${item.id}:${item.jobOfferId ?? "legacy"}`}
                      className="whitespace-normal focus:bg-[#3a3a3e] focus:text-white">
                      {item.name}{item.jobOfferId ? ` · ${copy("Job")} #${item.jobOfferId}` : ""} · {money(item.dailyRateCents)} {copy("Per day")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : <select
              aria-label={copy("Approved daily service")}
              className={field}
              value={service}
              disabled={locked || frozen}
              onChange={(event) => setService(event.target.value)}
            >
              <option value="">{copy("Choose an approved service")}</option>
              {state.setup.services.map((item) => (
                <option key={`${item.id}:${item.jobOfferId ?? "legacy"}`} value={`${item.id}:${item.jobOfferId ?? "legacy"}`}>
                  {item.name} ·{" "}
                  {item.jobOfferId ? `${copy("Job")} #${item.jobOfferId} · ${copy("AFE")}: ${item.afe} · ` : ""}
                  {money(
                    frozen && config?.workTypeId === item.id
                      ? config.dailyRateCents
                      : item.dailyRateCents,
                  )}{" "}
                  {copy("Per day")}
                </option>
              ))}
            </select>}
          </div>
          {!state.setup.services.length ? (
            <p>
              {copy(
                "Select an accepted job with a partner-assigned AFE and Gate authorization.",
              )}
            </p>
          ) : null}
          {config?.jobOfferId ? <p>{copy("Job")}: #{config.jobOfferId} · {copy("AFE")}: {config.afe}</p> : null}
          <div>
            <label className="space-y-1">
              <span>{copy("Period starts")}</span>
              <input
                aria-label={copy("Period starts")}
                type="date"
                className={field}
                value={start}
                disabled={locked || frozen}
                onChange={(event) => setStart(event.target.value)}
              />
            </label>
          </div>
          {!dashboardPostId && <label className="block space-y-1">
            <span>{copy("Partial-day billing")}</span>
            <select
              aria-label={copy("Partial-day billing")}
              className={field}
              value={rule}
              disabled={locked || frozen}
              onChange={(event) => setRule(event.target.value as typeof rule)}
            >
              <option value="full_day">{copy("Full daily rate")}</option>
              <option value="prorate_actual_day">
                {copy("Prorate by actual day length")}
              </option>
            </select>
          </label>}
          {frozen && (
            <p>
              {copy("Close the current period before changing its agreement.")}
            </p>
          )}
          <label className="flex items-center gap-3">
            <Switch
              aria-label={copy("Automatic billing")}
              className="data-[state=checked]:bg-[var(--brand-primary)] data-[state=unchecked]:bg-[#5f646d] [&>span]:bg-white"
              checked={automatic}
              disabled={locked}
              onCheckedChange={setAutomatic}
            />
            <span>{copy("Automatic billing")}</span>
          </label>
          {automatic ? (
            <>
              <label className="block space-y-1">
                <span>{copy("Interval in completed days")}</span>
                <input
                  aria-label={copy("Interval in completed days")}
                  className={field}
                  type="number"
                  min="1"
                  max="366"
                  value={interval}
                  disabled={locked}
                  onChange={(event) => setIntervalDays(event.target.value)}
                />
              </label>
              <p>
                {copy(
                  "Automatic billing submits reviewed coverage at the saved interval; partner approval still applies.",
                )}
              </p>
              <p>
                {copy(
                  "Partial or missing recorded coverage pauses automatic billing for office review.",
                )}
              </p>
            </>
          ) : null}
          {dashboardPostId ? (
            <button type="button" className={miniCard}
              disabled={locked || !selectedService || !start}
              onClick={save}>{copy("Start Ticket")}</button>
          ) : <PngPillButton
            disabled={
              locked || !service || !start
            }
            onClick={save}
          >
            {copy("Save billing setup")}
          </PngPillButton>}
        </section>
      ) : null}
      {state.preview ? (
        <section className={card}>
          <p>
            {copy("Partner")}:{" "}
            {state.setup?.post.partnerName || config?.partnerId}
          </p>
          <p>
            {copy("Site")}: {state.setup?.post.siteName}
          </p>
          <p>
            {copy("Gate post")}: {state.setup?.post.name}
          </p>
          <p>
            {copy("AFE")}: {config?.afe || "—"}
          </p>
          <p>
            {copy("Period daily rate")}:{" "}
            {money(state.preview.config.dailyRateCents)}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <p>
              {copy("Current ticket")}: {config?.openTicketId ?? "—"}
            </p>
            <p>
              {copy("Last billed through")}:{" "}
              {config?.lastBilledThroughDay ?? "—"}
            </p>
            <p>
              {copy("Through")}: {state.preview.period.throughDay} · Central
            </p>
            <p>
              {copy("Recorded billable days")}:{" "}
              {state.preview.period.billableDays}
            </p>
            <p className="text-xl font-bold">
              {copy("Total")}: {money(state.preview.period.totalCents)}
            </p>
          </div>
          {state.preview.period.days.some((day) => day.hasCoverageGap) ? (
            <p>
              {copy(
                "Some days have partial or missing recorded coverage. Review before submitting.",
              )}
            </p>
          ) : null}
          <p>
            {copy(
              "Partner approval is required before the invoice is generated.",
            )}
          </p>
          {config?.openTicketId && !dashboardPostId ? (
            <label className="flex items-center gap-3">
              <BrandedCheckbox
                aria-label={copy("Start next billing ticket")}
                checked={continueBilling}
                disabled={locked}
                onCheckedChange={(value) => setContinue(value === true)}
              />
              <span>{copy("Start next billing ticket")}</span>
            </label>
          ) : null}
          {!state.preview.period.billableDays ? (
            <p>{copy("No completed billable days yet.")}</p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            {dashboardPostId ? (
              <>
                {dialogAction !== "end" && (
                  <button type="button" className={miniCard} disabled={locked || config?.openTicketId !== selectedTicket?.id || !state.preview.period.billableDays}
                    onClick={() => void workflow?.invoiceNow(true)}>{copy("Start New Ticket")}</button>
                )}
                <button type="button" className={miniCard} disabled={locked || config?.openTicketId !== selectedTicket?.id || !state.preview.period.billableDays}
                  onClick={() => void workflow?.invoiceNow(false)}>{copy("Close Ticket")}</button>
              </>
            ) : (
              <PngPillButton disabled={locked || !config?.openTicketId || !state.preview.period.billableDays}
                onClick={() => void workflow?.invoiceNow(continueBilling)}>{copy("Invoice Now")}</PngPillButton>
            )}
            <PngPillButton
              disabled={locked}
              onClick={() => void workflow?.refresh()}
            >
              {copy("Refresh preview")}
            </PngPillButton>
          </div>
        </section>
      ) : null}
      {state.result ? (
        <section className={card} role="status">
          {state.result.status === "submitted" ? (
            <>
              <p>
                {copy(
                  "Submitted ticket {ticket} for partner approval.",
                ).replace("{ticket}", String(state.result.ticketId))}
              </p>
              <p>
                {state.result.nextTicketId
                  ? copy("Next ticket: {ticket}.").replace(
                      "{ticket}",
                      String(state.result.nextTicketId),
                    )
                  : copy("Billing stopped after this period.")}
              </p>
            </>
          ) : (
            <p>{copy("Billing is not due yet.")}</p>
          )}
        </section>
      ) : null}
    </div>
  );
  if (!dashboardPostId) return content;
  return (
    <div className="gate-panel-body gate-billing-ticket-lists space-y-3">
      {(scopeError || state.errorCode) && <p role="alert">{gateDailyBillingError(scopeError || state.errorCode!, i18n.language)}</p>}
      {(!tickets && !inventoryError || opening) && <p role="status">{copy("Working…")}</p>}
      {inventoryError && <p role="alert">{copy("Could not load billing tickets.")}</p>}
      {tickets && (
        <section aria-label={copy("Ticketed Money Inflow/Outflow")} className="space-y-2 pb-1">
          <h3 className="text-sm font-semibold">{copy("Ticketed Money Inflow/Outflow")}</h3>
          {showGateGoDemo ? <GateTicketProfitability tickets={tickets} money={money} /> : (
          <details className="gate-panel-disclosure gate-profitability-card">
          <summary><span className="mr-auto">{copy("Estimated Profitability")}</span></summary>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 pb-3">
          <dt>{copy("This Quarter")}</dt>
          <dd className="text-right text-[#86efac]">{money(tickets.reduce((total, ticket) => total + (ticket.quarterCents ?? 0), 0))}</dd>
          <dt>{copy("Accrued payroll")}</dt>
          <dd className="text-right text-[#fca5a5]">{money(-tickets.reduce((total, ticket) => total + (ticket.quarterPayrollCents ?? 0), 0) || 0)}</dd>
          <dt>{copy("Year to Date")}</dt>
          <dd className="text-right text-[#86efac]">{money(tickets.reduce((total, ticket) => total + (ticket.yearToDateCents ?? 0), 0))}</dd>
          <dt>{copy("Accrued payroll")}</dt>
          <dd className="text-right text-[#fca5a5]">{money(-tickets.reduce((total, ticket) => total + (ticket.yearToDatePayrollCents ?? 0), 0) || 0)}</dd>
          </dl>
          </details>
          )}
        </section>
      )}
      {tickets && <div className="gate-billing-ticket-subcard">
      <h3 className="pt-3 text-sm font-semibold">{copy("Recent Tickets")}</h3>
      <div className="gate-billing-ticket-scroll" role="region" aria-label={copy("Recent Tickets")} tabIndex={0}>
      <p className="text-xs text-muted-foreground">{i18n.language?.startsWith("es") ? "Facturación de toda la empresa · todos los sitios" : "Company-wide billing · all sites"}</p>
      {ticketLists.map(({ group, label, singular }) => {
        const rows = tickets.filter(ticket => ticket.group === group);
        const total = rows.reduce((sum, ticket) => sum + ticket.invoiceCents, 0);
        const paid = rows.reduce((sum, ticket) => sum + (ticket.status === "funds_dispersed" ? ticket.invoiceCents : 0), 0);
        const compact = new Intl.NumberFormat(i18n.language, {
          style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1,
        });
        const percentPaid = total > 0 ? Math.round(100 * paid / total) : 0;
        return (
          <details key={group} className="gate-panel-disclosure">
            <summary>
              <span>{copy(rows.length === 1 ? singular : label).replace("{count}", String(rows.length))}</span>
              <small aria-hidden={group === "unstarted" || undefined}
                title={group === "closed" ? `${money(paid)} paid / ${money(total - paid)} unpaid` : undefined}>
                {group === "closed" ? `${compact.format(paid / 100)}/${compact.format((total - paid) / 100)}/${percentPaid}% paid`
                  : group === "open" ? money(total) : null}
              </small>
            </summary>
            <ul className="space-y-2 pb-2">
              {rows.map(ticket => {
                const demo = showGateGoDemo && !ticket.estimate ? gateGoDemoCosts(ticket) : null;
                const payroll = demo?.wages ?? ticket.payrollCents;
                const estimate = ticket.estimate && payroll != null ? calculateTicketEstimate(ticket.invoiceCents, payroll, ticket.estimate) : null;
                const profit = estimate?.operating ?? demo?.profit ?? (payroll == null ? null : ticket.invoiceCents - payroll);
                return (
                <li key={ticket.id} className="gate-billing-ticket-card space-y-1 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    {group === "open" ? (
                      <button type="button" className={`${ticketAction} font-bold`} style={{ color: ticketColors[ticket.tone] }}
                        onClick={() => setEditing(ticket)}>{formatTicketTrackingNumber(ticket.id)}</button>
                    ) : <strong style={{ color: ticketColors[ticket.tone] }}>{formatTicketTrackingNumber(ticket.id)}</strong>}
                    <span className={ticket.tone === "green" ? "text-[#86efac]" : "text-[#a3a3a3]"}>{ticket.status === "funds_dispersed" ? copy("PAID") : (i18n.language?.startsWith("es") ? "SIN PAGAR" : "UNPAID")}</span>
                  </div>
                  <div className="flex flex-wrap justify-between gap-x-3 text-[#b3b3b3]">
                    <span>{[ticket.siteName, ticket.gateName].filter(Boolean).join(" · ")}</span>
                    <span>{ticket.daysSinceBilled} {copy("days since last billed")}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0" aria-label={formatTicketTrackingNumber(ticket.id)}>
                    {group === "closed" ? <>
                      <button type="button" className={ticketAction} onClick={() => setReviewing(ticket)}>{copy("Review")}</button>
                      {ticket.status === "kicked_back" && (
                        <a className={`${ticketAction} inline-flex items-center`} href={`${base}/tickets/${ticket.id}?amend=1`}>{copy("Amend")}</a>
                      )}
                    </> : <>
                    <button type="button" className={ticketAction}
                      disabled={opening || !workflow || !ticket.stationId || ticket.group !== "unstarted" || ["funds_dispersed", "cancelled", "denied"].includes(ticket.status)}
                      onClick={() => void openTicketAction(ticket, "start")}>{copy("Start Ticket")}</button>
                    <button type="button" className={ticketAction}
                      disabled={opening || !workflow || ticket.group !== "open" || ["funds_dispersed", "cancelled", "denied"].includes(ticket.status)}
                      onClick={() => void openTicketAction(ticket, "invoice")}>{copy("Invoice Now")}</button>
                    <button type="button" className={ticketAction}
                      disabled={opening || !workflow || ticket.group !== "open" || ["funds_dispersed", "cancelled", "denied"].includes(ticket.status)}
                      onClick={() => void openTicketAction(ticket, "end")}>{copy("Close Ticket")}</button>
                    </>}
                  </div>
                  {group !== "unstarted" && (
                    <details className="gate-panel-disclosure">
                    <summary><span className="mr-auto">{copy("Estimated Profitability")}</span></summary>
                    <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 pb-2">
                      <dt>{copy("Invoice amount")}</dt><dd className="text-right text-white">{money(ticket.invoiceCents)}</dd>
                      <dt>{copy("Accrued payroll")}</dt>
                      <dd className="text-right text-[#fca5a5]">{payroll == null ? "—" : money(-payroll || 0)}</dd>
                      {estimate && <>
                        <dt>Equipment purchases</dt><dd className="text-right text-[#fca5a5]">{money(-estimate.purchases || 0)}</dd>
                        <dt>Equipment rentals</dt><dd className="text-right text-[#fca5a5]">{money(-estimate.rentals || 0)}</dd>
                        <dt>Estimated tax reserve</dt><dd className="text-right text-[#fca5a5]">{money(-estimate.reserve || 0)}</dd>
                        <dt>Estimated after-tax profit</dt><dd className="text-right">{money(estimate.afterTax)}</dd>
                      </>}
                      {demo && <>
                        <dt>Employer payroll taxes (demo)</dt><dd className="text-right text-[#fca5a5]">{money(-demo.employerTaxes || 0)}</dd>
                        <dt>Purchases &amp; Rentals (demo)</dt><dd className="text-right text-[#fca5a5]">{money(-demo.equipment || 0)}</dd>
                        {demo.items.map(([kind, name, cents]) => (
                          <div key={name} className="col-span-2 flex justify-between gap-2 text-xs text-[#b3b3b3]">
                            <dt>{kind} · {name}</dt><dd>{money(cents)}</dd>
                          </div>
                        ))}
                      </>}
                      <dt>{copy("Estimated profit")}</dt>
                      <dd className="text-right">{profit == null ? "—" : <>
                        {money(profit)}
                        {ticket.invoiceCents > 0 && ` (${new Intl.NumberFormat(i18n.language, { style: "percent", maximumFractionDigits: 1 }).format(profit / ticket.invoiceCents)})`}
                      </>}</dd>
                      {demo && <>
                        <dt>Federal tax reserve (demo)</dt><dd className="text-right text-[#fca5a5]">{money(-demo.reserve || 0)}</dd>
                        <dt>Profit after reserve</dt><dd className="text-right">{money(demo.profit - demo.reserve)}</dd>
                      </>}
                    </dl>
                    </details>
                  )}
                </li>
                );
              })}
            </ul>
          </details>
        );
      })}
      </div>
      </div>}
      <Dialog open={reviewing !== null} onOpenChange={open => { if (!open) setReviewing(null); }}>
        {reviewing && <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{copy("Review")} · {formatTicketTrackingNumber(reviewing.id)}</DialogTitle>
            <DialogDescription>{[reviewing.serviceName, reviewing.siteName, reviewing.gateName].filter(Boolean).join(" · ")}</DialogDescription>
          </DialogHeader>
          <dl className="gate-billing-ticket-subcard grid grid-cols-[1fr_auto] gap-2 py-3">
            <dt>{copy("Invoice amount")}</dt><dd>{money(reviewing.invoiceCents)}</dd>
            <dt>{copy("days since last billed")}</dt><dd>{reviewing.daysSinceBilled}</dd>
            <dt>{copy("Accrued payroll")}</dt><dd>{reviewing.payrollCents == null ? "—" : money(-reviewing.payrollCents || 0)}</dd>
          </dl>
          <a className={ticketAction} href={`${base}/tickets/${reviewing.id}?review=1`}>Open full ticket</a>
        </DialogContent>}
      </Dialog>
      {editing && <GateTicketEstimate ticket={editing} request={request} money={money} close={() => setEditing(null)}
        saved={estimate => {
          setTickets(current => current?.map(ticket => ticket.id === editing.id ? { ...ticket, estimate } : ticket) ?? null);
          setEditing(null);
        }} />}
      <Dialog open={dialogAction !== null} onOpenChange={(open) => { if (!open) setDialogAction(null); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{copy(dialogAction === "end" ? "Close Ticket" : dialogAction === "invoice" ? "Invoice Now" : "Start Ticket")}</DialogTitle>
            {selectedTicket && <p className="text-sm text-[#ececec]">
              <strong>{formatTicketTrackingNumber(selectedTicket.id)}</strong>
              <span className="block">{[selectedTicket.serviceName, selectedTicket.siteName, selectedTicket.gateName].filter(Boolean).join(" · ")}</span>
            </p>}
          </DialogHeader>
          <DialogDescription>
            {dialogAction === "end"
              ? copy("Close Ticket closes the period without opening another.")
              : dialogAction === "invoice"
              ? copy("Submit this period for partner approval. Start New Ticket continues from the next unbilled day. Close Ticket closes the period without opening another.")
              : copy("Choose an approved service")}
          </DialogDescription>
          {content}
        </DialogContent>
      </Dialog>
    </div>
  );
}
