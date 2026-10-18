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
import { BrandedCheckbox } from "@/components/branded-checkbox";
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
}: {
  scopeKey: string;
  request?: GateBillingRequest;
}) {
  return <ScopedPanel key={scopeKey} request={request} />;
}
function ScopedPanel({ request }: { request: GateBillingRequest }) {
  const { i18n } = useTranslation(),
    copy = (text: string) => gateDailyBillingCopy(text, i18n.language),
    [workflow, setWorkflow] = useState<ReturnType<
      typeof createGateDailyBillingWorkflow
    > | null>(null);
  useEffect(() => {
    const value = createGateDailyBillingWorkflow({
      request,
      operationId: () => crypto.randomUUID(),
    });
    setWorkflow(value);
    void value.load();
    return () => value.dispose();
  }, [request]);
  const state = useSyncExternalStore(
      workflow?.subscribe ?? (() => () => {}),
      workflow?.getSnapshot ?? (() => empty),
      () => empty,
    ),
    config = state.setup?.config,
    locked = state.busy || Boolean(state.pending),
    frozen = Boolean(config?.openTicketId);
  const [service, setService] = useState(""),
    [start, setStart] = useState(""),
    [agreement, setAgreement] = useState(""),
    [rule, setRule] = useState<"full_day" | "prorate_actual_day">("full_day"),
    [confirmed, setConfirmed] = useState(false),
    [automatic, setAutomatic] = useState(false),
    [interval, setIntervalDays] = useState("30"),
    [continueBilling, setContinue] = useState(true);
  useEffect(() => {
    const value = state.setup?.config;
    setService(
      value
        ? String(value.workTypeId)
        : state.setup?.services.length === 1
          ? String(state.setup.services[0].id)
          : "",
    );
    setStart(
      value?.periodStartDay ??
        fleetInstantToWallTime(
          new Date().toISOString(),
          "America/Chicago",
        )!.slice(0, 10),
    );
    setAgreement(value?.agreementReference ?? "");
    setRule(value?.partialDayRule ?? "full_day");
    setConfirmed(Boolean(value));
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
    card =
      "space-y-4 rounded-xl border-2 border-[var(--brand-primary)] bg-card p-4 text-card-foreground";
  const save = () =>
    void workflow?.configure({
      workTypeId: Number(service),
      startDay: start,
      agreementReference: agreement,
      partialDayRule: rule,
      confirmedUnbilledStart: confirmed as true,
      autoInvoiceEveryDays: automatic ? Number(interval) : null,
    });
  return (
    <div className="space-y-4" aria-busy={state.busy}>
      <section className={card}>
        <p>
          {copy(
            "Staff shifts and Gate coverage continue independently of billing.",
          )}
        </p>
        <p>{copy("Billing includes only completed days in Central time.")}</p>
        <label className="block space-y-1">
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
        </label>
        {state.nextCursor ? (
          <PngPillButton
            disabled={locked}
            onClick={() => void workflow?.load(state.nextCursor!)}
          >
            {copy("Load more posts")}
          </PngPillButton>
        ) : null}
        {!state.busy && !state.posts.length && !state.errorCode ? (
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
      {state.setup ? (
        <section className={card}>
          <label className="block space-y-1">
            <span>{copy("Approved daily service")}</span>
            <select
              aria-label={copy("Approved daily service")}
              className={field}
              value={service}
              disabled={locked || frozen}
              onChange={(event) => setService(event.target.value)}
            >
              <option value="">{copy("Choose an approved service")}</option>
              {state.setup.services.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ·{" "}
                  {money(
                    frozen && config?.workTypeId === item.id
                      ? config.dailyRateCents
                      : item.dailyRateCents,
                  )}{" "}
                  {copy("Per day")}
                </option>
              ))}
            </select>
          </label>
          {!state.setup.services.length ? (
            <p>
              {copy(
                "Choose an approved per-day service before starting billing.",
              )}
            </p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
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
            <label className="space-y-1">
              <span>{copy("Agreement reference")}</span>
              <input
                aria-label={copy("Agreement reference")}
                className={field}
                value={agreement}
                disabled={locked || frozen}
                onChange={(event) => setAgreement(event.target.value)}
              />
            </label>
          </div>
          <label className="block space-y-1">
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
          </label>
          {frozen ? (
            <p>
              {copy("Close the current period before changing its agreement.")}
            </p>
          ) : (
            <label className="flex items-center gap-3">
              <BrandedCheckbox
                aria-label={copy(
                  "Confirm this starts after all previously billed days.",
                )}
                checked={confirmed}
                disabled={locked}
                onCheckedChange={(value) => setConfirmed(value === true)}
              />
              <span>
                {copy("Confirm this starts after all previously billed days.")}
              </span>
            </label>
          )}
          <label className="flex items-center gap-3">
            <BrandedCheckbox
              aria-label={copy("Automatic billing")}
              checked={automatic}
              disabled={locked}
              onCheckedChange={(value) => setAutomatic(value === true)}
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
          <PngPillButton
            disabled={
              locked || !service || !start || !agreement.trim() || !confirmed
            }
            onClick={save}
          >
            {copy("Save billing setup")}
          </PngPillButton>
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
          {config?.openTicketId ? (
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
            <PngPillButton
              disabled={
                locked ||
                !config?.openTicketId ||
                !state.preview.period.billableDays
              }
              onClick={() => void workflow?.invoiceNow(continueBilling)}
            >
              {copy("Invoice Now")}
            </PngPillButton>
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
}
