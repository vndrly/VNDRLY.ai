import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { fleetClient } from "@/lib/fleet-client";
import { PngPillButton } from "./png-pill-rollover";
import type {FleetWorkSession} from "@workspace/api-zod";

export type FleetBillingDraft = {
  mode: "new_ticket" | "existing_ticket";
  workTypeId: string;
  ticketId: string;
  afeNumber: string;
  workDate: string;
};
export type FleetBillingOptions = {
  workTypes: {
    id: number;
    name: string;
    rateCents?: number;
    afeNumber?: string;
    unit?: string|null;
  }[];
  tickets: {
    id: number;
    ticketNumber: number;
    siteId: number;
    afeNumber: string;
    workDate: string;
    planVersion: number;
  }[];
  afeRequired: boolean;
  siteAfe: string;
  referenceFreshness?:"current"|"cached_unverified";
};
export type FleetBillingTicket = {
  ticketId: number;
  siteId: number;
  partnerId: number;
  status: string;
  afeNumber: string;
  workDate: string;
  plan: { version: number; closedAt: string | null } | null;
  charges: { runs: number; total: string };
  runs: { id: string; title: string; status: string; version: number }[];
  canFinalize: boolean;
  finalizationOperationId: string | null;
};
const copy = (es: boolean) =>
  es
    ? {
        heading: "Facturación del recorrido",
        fresh: "Recorrido como ticket nuevo",
        existing: "Agregar recorrido a ticket",
        afe: "AFE",
        date: "Fecha de trabajo",
        service: "Servicio de facturación",
        ticket: "Ticket abierto",
        choose: "Seleccionar",
        hint: "Solo tickets abiertos del mismo sitio de facturación, AFE y fecha de trabajo.",
        empty:
          "No hay un ticket abierto elegible. Cree un ticket nuevo para este recorrido.",
        site: "Seleccione primero el sitio de recogida / facturación.",
        loading: "Cargando opciones de facturación…",
        error:
          "No se pudieron cargar las opciones. Actualice para volver a intentar.",
        noServices:
          "No hay un servicio de facturación asignado. Revise los servicios, tarifas y asignaciones del sitio.",
        refresh: "Actualizar opciones",
        review: "Revisar envío del ticket",
        submit: "Finalizar y enviar ticket",
        retry: "Reintentar el mismo envío",
        unknown:
          "El envío no fue confirmado. Reintente la misma solicitud; se conserva su referencia.",
        verified: "enviado. Estado guardado verificado.",
        pending: "Pendiente de revisión de oficina",
        ready: "Revisado",
        cancelled: "Cancelado",
        working: "Recorrido abierto",
        keep: "El ticket permanece abierto para más recorridos hasta que la oficina lo finalice.",
        warning:
          "Confirme el sitio, AFE, fecha y recorridos revisados. Al enviar, este ticket deja de aceptar recorridos.",
        cancel: "Volver a revisar",
        unavailable:
          "Los detalles de facturación no están disponibles con su acceso actual.",
        submitted: "Enviado",
        total: "Total de recorridos revisados",
      }
    : {
        heading: "Run billing",
        fresh: "Run as new ticket",
        existing: "Add run to ticket",
        afe: "AFE",
        date: "Work date",
        service: "Billing service",
        ticket: "Open ticket",
        choose: "Choose",
        hint: "Only open tickets for the same billing site, AFE and work date are eligible.",
        empty: "No eligible open ticket. Run as a new ticket for this work.",
        site: "Choose the pickup / billing site first.",
        loading: "Loading billing options…",
        error: "Billing options could not be loaded. Refresh to retry.",
        noServices:
          "No assigned billing service is available. Review company services, rates and site assignments.",
        refresh: "Refresh options",
        review: "Review ticket submission",
        submit: "Finalize and submit ticket",
        retry: "Retry exact submission",
        unknown:
          "Submission was not confirmed. Retry the exact request; its reference is preserved.",
        verified: "submitted. Saved status verified.",
        pending: "Awaiting office review",
        ready: "Reviewed",
        cancelled: "Cancelled",
        working: "Open run",
        keep: "This ticket stays open for additional runs until the office finalizes it.",
        warning:
          "Confirm the site, AFE, work date and reviewed runs. Submission closes this ticket to additional runs.",
        cancel: "Back to review",
        unavailable:
          "Billing ticket details are unavailable with your current access.",
        submitted: "Submitted",
        total: "Reviewed run total",
      };
const preciseUnitLabel=(unit:string|null|undefined,spanish:boolean)=>{
 const labels:Record<string,string>={per_barrel:"por barril",per_us_gallon:"por galón estadounidense",per_short_ton:"por tonelada corta",per_load:"por carga",per_mile:"por milla",per_job:"por trabajo",lump_sum:"suma global"};
 return unit?(spanish?labels[unit]??unit.replaceAll("_"," "):unit.replaceAll("_"," ")):(spanish?"Acuerdo sin resolver":"Agreement unresolved");
};

export function FleetRunBillingFields({
  fleetId,
  siteId,
  identity,
  value,
  onChange,
  onValidityChange,
  disabled,
  workSession,
}: {
  fleetId?: string;
  siteId: number;
  identity: string;
  value: FleetBillingDraft;
  onChange: (value: FleetBillingDraft) => void;
  onValidityChange?: (valid: boolean) => void;
  disabled: boolean;
  workSession?:FleetWorkSession|null;
}) {
  const { i18n } = useTranslation(),
    c = copy(i18n.language.startsWith("es"));
  const scope = `${identity}:${fleetId ?? ""}:${siteId}`,
    seenScope = useRef("");
  const query = useQuery<FleetBillingOptions>({
    queryKey: [
      "fleet-billing-options",
      identity,
      fleetId,
      siteId,
      value.afeNumber,
      value.workDate,
      workSession?.scope.provisioningId,
    ],
    queryFn: () => workSession&&fleetId?workSession.billingOptions({fleetId,siteId,afeNumber:value.afeNumber,workDate:value.workDate}):
      fleetClient.billingOptions(
        siteId,
        value.afeNumber,
        value.workDate,
        fleetId,
      ),
    enabled: siteId > 0 && /^\d{4}-\d{2}-\d{2}$/.test(value.workDate),
    retry: false,
  });
  const data = query.isError ? undefined : query.data;
  useEffect(() => {
    if (data && seenScope.current !== scope) {
      seenScope.current = scope;
      onChange({
        ...value,
        afeNumber: data.siteAfe || value.afeNumber,
        workTypeId: "",
        ticketId: "",
      });
    }
  }, [scope, data]);
  const valid = Boolean(
    data &&
    (!data.afeRequired || value.afeNumber.trim()) &&
    (value.mode === "new_ticket"
      ? data.workTypes.some(
          (item) =>
            item.id === Number(value.workTypeId) &&
            (item.afeNumber === undefined ||
              item.afeNumber === value.afeNumber.trim()),
        )
      : (!workSession||data.workTypes.some(item=>item.id===Number(value.workTypeId)&&(item.afeNumber===undefined||item.afeNumber===value.afeNumber.trim())))&&data.tickets.some(
          (item) =>
            item.id === Number(value.ticketId) &&
            item.siteId === siteId &&
            item.afeNumber === value.afeNumber.trim() &&
            item.workDate === value.workDate,
        )),
  );
  useEffect(() => {
    onValidityChange?.(valid);
  }, [valid, onValidityChange]);
  const change = (update: Partial<FleetBillingDraft>) =>
    onChange({ ...value, ...update });
  return (
    <div className="fleet-detail-group space-y-3" aria-label={c.heading}>
      <h3>{c.heading}</h3>
      {data?.referenceFreshness==="cached_unverified"&&<p role="status">{i18n.language.startsWith("es")?"Opciones descargadas sin verificar; la oficina y el servidor revisarán la autoridad al sincronizar.":"Downloaded choices are unverified; authority is checked again when work synchronizes."}</p>}
      <div className="flex flex-wrap gap-3" role="group" aria-label={c.heading}>
        <PngPillButton
          disabled={disabled}
          aria-pressed={value.mode === "new_ticket"}
          onClick={() => change({ mode: "new_ticket", ticketId: "" })}
        >
          {c.fresh}
        </PngPillButton>
        <PngPillButton
          disabled={disabled}
          aria-pressed={value.mode === "existing_ticket"}
          onClick={() => change({ mode: "existing_ticket", workTypeId: "" })}
        >
          {c.existing}
        </PngPillButton>
      </div>
      <div className="fleet-asset-fields">
        <label>
          {c.afe}
          <input
            disabled={disabled}
            value={value.afeNumber}
            maxLength={200}
            onChange={(event) =>
              change({ afeNumber: event.target.value, ticketId: "" })
            }
          />
        </label>
        <label>
          {c.date}
          <input
            type="date"
            disabled={disabled}
            value={value.workDate}
            onChange={(event) =>
              change({ workDate: event.target.value, ticketId: "" })
            }
          />
        </label>
        {data && (value.mode === "new_ticket"||!!workSession) && (
          <label>
            {c.service}
            <select
              disabled={disabled}
              value={value.workTypeId}
              onChange={(event) => {
                const service = data.workTypes.find(
                  (item) => item.id === Number(event.target.value),
                );
                change({
                  workTypeId: event.target.value,
                  ...(service?.afeNumber !== undefined
                    ? { afeNumber: service.afeNumber }
                    : {}),
                });
              }}
            >
              <option value="">{c.choose}</option>
              {data.workTypes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {typeof item.rateCents === "number" && (
                    <>
                      {" "}
                      ·{" "}
                      {(item.rateCents / 100).toLocaleString(i18n.language, {
                        style: "currency",
                        currency: "USD",
                      })}
                    </>
                  )}
                  {item.unit === "per_hour"
                    ? i18n.language.startsWith("es")
                      ? " / hora"
                      : " / hour"
                    : item.unit === "per_day"
                      ? i18n.language.startsWith("es")
                        ? " / día"
                        : " / day"
                      : workSession?` · ${preciseUnitLabel(item.unit,i18n.language.startsWith("es"))}`:i18n.language.startsWith("es")
                        ? " / recorrido"
                        : " / run"}
                  {item.afeNumber ? ` · AFE ${item.afeNumber}` : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        {data && value.mode === "existing_ticket" && (
          <label>
            {c.ticket}
            <select
              disabled={disabled}
              value={value.ticketId}
              onChange={(event) => change({ ticketId: event.target.value })}
            >
              <option value="">{c.choose}</option>
              {data.tickets.map((item) => (
                <option key={item.id} value={item.id}>
                  #{item.ticketNumber} · {item.workDate} ·{" "}
                  {item.afeNumber || "—"}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <p role="status">
        {!siteId
          ? c.site
          : query.isError
            ? c.error
            : !data
              ? c.loading
              : value.mode === "existing_ticket" && !data.tickets.length
                ? c.empty
                : value.mode === "new_ticket" && !data.workTypes.length
                  ? c.noServices
                  : c.hint}
      </p>
      {query.isError && (
        <PngPillButton disabled={disabled} onClick={() => void query.refetch()}>
          {c.refresh}
        </PngPillButton>
      )}
    </div>
  );
}

export function FleetBillingTicketPanel({
  ticketId,
  identity,
}: {
  ticketId: number;
  identity: string;
}) {
  const { i18n } = useTranslation(),
    c = copy(i18n.language.startsWith("es")),
    cache = useQueryClient();
  const query = useQuery({
    queryKey: ["fleet-billing-ticket", identity, ticketId],
    queryFn: () => fleetClient.billingTicket(ticketId),
    retry: false,
  });
  const [attempt, setAttempt] = useState<{
      operationId: string;
      expectedVersion: number;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [sent, setSent] = useState(false);
  const data = query.isError ? undefined : query.data;
  async function submit() {
    if (!attempt || busy) return;
    setBusy(true);
    setSent(true);
    setMessage("");
    try {
      let rejection: unknown;
      try {
        await fleetClient.finalizeBillingTicket(ticketId, attempt);
      } catch (error) {
        rejection = error;
      }
      const saved = await fleetClient.billingTicket(ticketId);
      if (
        saved.status !== "submitted" ||
        saved.finalizationOperationId !== attempt.operationId ||
        !saved.plan?.closedAt
      ) {
        const status = (rejection as { status?: number } | undefined)?.status;
        if (
          status &&
          status >= 400 &&
          status < 500 &&
          ![408, 429].includes(status)
        ) {
          cache.setQueryData(
            ["fleet-billing-ticket", identity, ticketId],
            saved,
          );
          setAttempt(null);
          setSent(false);
          setMessage(
            i18n.language.startsWith("es")
              ? "El ticket cambió o el envío fue rechazado. Revise los datos actuales antes de preparar otro envío."
              : "The ticket changed or submission was rejected. Review the current details before preparing another submission.",
          );
          return;
        }
        throw new Error("Unverified submission");
      }
      cache.setQueryData(["fleet-billing-ticket", identity, ticketId], saved);
      setAttempt(null);
      setMessage(`Ticket #${ticketId} ${c.verified}`);
      void cache.invalidateQueries({ queryKey: ["fleet", identity] });
    } catch {
      setMessage(c.unknown);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3" aria-label={`${c.heading} #${ticketId}`}>
      <h3>Ticket #{ticketId}</h3>
      {!data ? (
        <p role="status">{c.unavailable}</p>
      ) : (
        <>
          <p>
            {c.afe}: {data.afeNumber || "—"} · {c.date}: {data.workDate || "—"}{" "}
            · {data.status === "submitted" ? c.submitted : data.status}
          </p>
          <p>{data.status === "submitted" ? c.submitted : c.keep}</p>
          <ul>
            {data.runs.map((run) => (
              <li key={run.id}>
                {run.title} ·{" "}
                {run.status === "completed"
                  ? c.ready
                  : run.status === "cancelled"
                    ? c.cancelled
                    : run.status === "submitted_for_review"
                      ? c.pending
                      : c.working}
              </li>
            ))}
          </ul>
          <p>
            {c.total}:{" "}
            {Number(data.charges.total).toLocaleString(i18n.language, {
              style: "currency",
              currency: "USD",
            })}
          </p>
          {data.canFinalize && data.plan && !attempt && (
            <PngPillButton
              onClick={() => {
                setAttempt({
                  operationId: crypto.randomUUID(),
                  expectedVersion: data.plan!.version,
                });
                setSent(false);
                setMessage("");
              }}
            >
              {c.review}
            </PngPillButton>
          )}
          {attempt && (
            <div className="fleet-detail-group space-y-3">
              <p>{c.warning}</p>
              <p>
                Ticket #{ticketId} · {c.afe}: {data.afeNumber || "—"} ·{" "}
                {data.workDate} · {data.runs.length}{" "}
                {i18n.language.startsWith("es") ? "recorridos" : "runs"}
              </p>
              <PngPillButton disabled={busy} onClick={() => void submit()}>
                {sent ? c.retry : `${c.submit} #${ticketId}`}
              </PngPillButton>
              {!sent && (
                <PngPillButton disabled={busy} onClick={() => setAttempt(null)}>
                  {c.cancel}
                </PngPillButton>
              )}
            </div>
          )}
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
