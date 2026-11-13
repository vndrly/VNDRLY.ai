import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import type { Ticket } from "@workspace/api-client-react";

const CLOSED = new Set(["completed", "funds_dispersed", "cancelled", "denied"]);

/** Mounted only for expanded operational sites; the API enforces the viewer's scope. */
export default function SiteTicketList({ siteId }: { siteId: number }) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const query = useInfiniteQuery({
    queryKey: ["site-ticket-history", user?.id, user?.vendorId, siteId],
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) => {
      const response = await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/tickets?siteLocationId=${siteId}&siteHistory=true&limit=50&offset=${pageParam}`, { credentials: "include", signal });
      if (!response.ok) throw new Error("Unable to load site tickets");
      return response.json() as Promise<{ items: Ticket[]; total: number }>;
    },
    getNextPageParam: (last, pages) => {
      const count = pages.reduce((sum, page) => sum + page.items.length, 0);
      return count < last.total && last.items.length ? count : undefined;
    },
  });
  const tickets = query.data?.pages.flatMap(page => page.items) ?? [];
  if (query.isPending) return <p role="status">{t("siteLocations.ticketRows.loading")}</p>;
  if (query.isError) return <button type="button" onClick={() => query.refetch()}>{t("siteLocations.ticketRows.retry")}</button>;
  return <div className="site-ticket-list">
    {!tickets.length && <p>{t("siteLocations.ticketRows.empty")}</p>}
    {[false, true].map(closed => {
      const group = tickets.filter(ticket => CLOSED.has(ticket.status) === closed);
      if (!group.length) return null;
      return <section key={String(closed)} aria-label={t(closed ? "siteLocations.ticketRows.history" : "siteLocations.ticketRows.current")}>
        <h3>{t(closed ? "siteLocations.ticketRows.history" : "siteLocations.ticketRows.current")}</h3>
        {group.map(ticket => <Link key={ticket.id} href={`/tickets/${ticket.id}`} className="site-ticket-link">
          <span>#{ticket.id} · {ticket.workTypeName}</span>
          <span>{t(`status.${ticket.status}`, { defaultValue: ticket.status.replaceAll("_", " ") })}</span>
        </Link>)}
      </section>;
    })}
    {query.hasNextPage && <button type="button" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>{t("siteLocations.ticketRows.more")}</button>}
  </div>;
}
