import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { fleetClient } from "@/lib/fleet-client";
import { fleetCopy } from "@/lib/fleet-copy";
import { PngPillButton } from "@/components/png-pill-rollover";
export function FleetSupportPanel({ identity }: { identity: string }) {
  const { i18n } = useTranslation();
  const c = fleetCopy(i18n.language);
  const [company, setCompany] = useState("");
  const choices = useQuery({
    queryKey: ["fleet-support-choices", identity],
    queryFn: fleetClient.supportChoices,
    retry: false,
  });
  const authorized =
    !choices.isError &&
    choices.data?.readOnly === true &&
    choices.data.companies.some(
      (item) =>
        item.companyId === Number(company) &&
        Date.parse(item.expiresAt) > Date.now(),
    );
  const query = useInfiniteQuery({
    queryKey: ["fleet-support", identity, company],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      fleetClient.supportCompany(Number(company), pageParam),
    getNextPageParam: (page) => page.page.nextCursor ?? undefined,
    enabled: Boolean(authorized),
    retry: false,
  });
  const pages =
    authorized && !query.isError
      ? query.data?.pages.filter(
          (page) =>
            page.companyId === Number(company) &&
            page.readOnly === true &&
            page.coordinateDisclosure === false &&
            Date.parse(page.expiresAt) > Date.now(),
        )
      : undefined;
  return (
    <main className="space-y-3 p-6">
      <h1>{c.support}</h1>
      <p>{c.supportScope}</p>
      {choices.isError ? (
        <p role="alert">{c.unavailable}</p>
      ) : (
        <label>
          {c.supportChoose}
          <select
            className="block rounded border p-2"
            value={company}
            onChange={(event) => setCompany(event.target.value)}
          >
            <option value="">{c.supportChoose}</option>
            {choices.data?.companies.map((item) => (
              <option value={item.companyId} key={item.companyId}>
                {item.companyName}
              </option>
            ))}
          </select>
        </label>
      )}
      <PngPillButton
        onClick={() => {
          void choices.refetch();
          if (authorized) void query.refetch();
        }}
      >
        {c.refresh}
      </PngPillButton>
      {query.isError && <p role="alert">{c.unavailable}</p>}
      {pages?.map((page, index) => (
        <section key={index} className="space-y-3">
          <h2>{page.companyName}</h2>
          <p>
            {c.supportReason}: {page.reason} · {c.supportExpires}:{" "}
            {new Date(page.expiresAt).toLocaleString(i18n.language)}
          </p>
          {page.runs.map((run) => (
            <article className="rounded border p-3" key={run.id}>
              <h3>
                {run.title} · {run.status}
              </h3>
              <p>{run.id}</p>
              {run.stops.map((stop) => (
                <p key={stop.id}>
                  {stop.sequence + 1}. {stop.kind} ·{" "}
                  {run.labels?.sites.find((site) => site.siteId === stop.siteId)
                    ?.name ?? `${c.site} ${stop.siteId}`}
                </p>
              ))}
              {run.loads.map((load) => (
                <p key={load.id}>
                  {load.commodity} · {load.quantity} {load.unit}
                </p>
              ))}
              {run.records.map((record) => (
                <p key={record.id}>
                  {record.kind} · {record.reading ?? record.quantity}{" "}
                  {record.unit} · {record.source} · {record.recordedAt}
                </p>
              ))}
            </article>
          ))}
        </section>
      ))}
      {authorized && query.hasNextPage && (
        <PngPillButton
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {c.loadMore}
        </PngPillButton>
      )}
    </main>
  );
}
