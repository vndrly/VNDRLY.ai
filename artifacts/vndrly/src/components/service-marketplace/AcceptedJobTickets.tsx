import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { createMarketplaceJobTicket, useListMarketplaceJobTickets, type MarketplaceJobOffer } from "@workspace/api-client-react";
import { PngPillButton as TogglePillButton } from "@/components/png-pill-rollover";

/** Shift tickets inherit scope, vendor, service, terms and AFE from the accepted job. */
export default function AcceptedJobTickets({ offer }: { offer: MarketplaceJobOffer }) {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const tickets = useListMarketplaceJobTickets(offer.id);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const operation = useRef<{ fingerprint: string; key: string } | null>(null);
  const locked = useRef(false);
  return <section className="space-y-3 rounded border p-3" aria-label={t("jobOffers.jobTickets")}>
    <h4 className="font-semibold">{t("jobOffers.jobTickets")}</h4>
    <p>{t("jobOffers.ticketInheritance", { job: offer.id, afe: offer.afeReference ?? "—" })}</p>
    {tickets.isError && <p role="alert">{t("jobOffers.ticketFailed")}</p>}
    <ul className="space-y-1">{tickets.data?.items.map((ticket) => <li key={ticket.id}>
      <a className="underline" href={`/tickets/${ticket.id}`}>#{ticket.id}</a> · {ticket.status.replaceAll("_", " ")}
      {ticket.scheduledStartAt && <> · {new Date(ticket.scheduledStartAt).toLocaleString()}</>}
    </li>)}</ul>
    <form className="space-y-3" onSubmit={async (event) => {
      event.preventDefault();
      if (locked.current) return;
      const from = Date.parse(start), to = Date.parse(end);
      if (!offer.afeReference?.trim() || !Number.isFinite(from) || !Number.isFinite(to) || to <= from ||
          !offer.scheduledStartAt || !offer.scheduledEndAt || from < Date.parse(offer.scheduledStartAt) || to > Date.parse(offer.scheduledEndAt)) {
        setError(true); return;
      }
      const body = { requestedStartAt: new Date(from).toISOString(), requestedEndAt: new Date(to).toISOString() };
      const fingerprint = JSON.stringify(body);
      if (operation.current?.fingerprint !== fingerprint) operation.current = { fingerprint, key: crypto.randomUUID() };
      locked.current = true; setBusy(true); setError(false);
      try {
        const result = await createMarketplaceJobTicket(offer.id, body, { headers: { "Idempotency-Key": operation.current.key } });
        await tickets.refetch();
        navigate(`/tickets/${result.ticketId}`);
      } catch { setError(true); }
      finally { locked.current = false; setBusy(false); }
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">{t("jobOffers.ticketStart")}
          <input className="rounded border bg-background p-2" type="datetime-local" required value={start} disabled={busy} onChange={(event) => setStart(event.target.value)} />
        </label>
        <label className="grid gap-1 text-sm">{t("jobOffers.ticketEnd")}
          <input className="rounded border bg-background p-2" type="datetime-local" required value={end} disabled={busy} onChange={(event) => setEnd(event.target.value)} />
        </label>
      </div>
      <p className="text-sm text-muted-foreground">{t("jobOffers.ticketSchedule")}</p>
      {error && <p role="alert">{t("jobOffers.ticketFailed")}</p>}
      <TogglePillButton color="blue" type="submit" disabled={busy || !offer.afeReference?.trim()}>{t("jobOffers.createTicket")}</TogglePillButton>
    </form>
  </section>;
}
