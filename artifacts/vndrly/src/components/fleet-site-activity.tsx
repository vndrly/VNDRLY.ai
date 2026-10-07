import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FleetSiteActivityFilterSchema } from "@workspace/api-zod";
import { fleetClient } from "@/lib/fleet-client";
import { fleetCopy } from "@/lib/fleet-copy";
import { PngPillButton } from "@/components/png-pill-rollover";

export function FleetSiteActivityPanel({ identity }: { identity: string }) {
  const { i18n } = useTranslation();
  const c = fleetCopy(i18n.language);
  const choices = useQuery({
    queryKey: ["fleet-site-choices", identity],
    queryFn: fleetClient.siteChoices,
    retry: false,
  });
  const [site, setSite] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [filter, setFilter] = useState<{ startsAt?: string; endsAt?: string }>(
    {},
  );
  const [invalid, setInvalid] = useState(false);
  const authorized =
    !choices.isError &&
    choices.data?.capabilities.canReadSiteActivity === true &&
    choices.data.sites.some((item) => item.siteId === Number(site));
  const activity = useQuery({
    queryKey: ["fleet-site-activity", identity, site, filter],
    queryFn: () => fleetClient.siteActivity(Number(site), filter),
    enabled: Boolean(authorized),
    retry: false,
  });
  const data =
    authorized &&
    !activity.isError &&
    activity.data?.siteId === Number(site) &&
    activity.data.coordinateDisclosure === false &&
    activity.data.source === "recorded_fleet_events"
      ? activity.data
      : undefined;
  const date = (value: string | null) =>
    value && Number.isFinite(Date.parse(value))
      ? new Date(value).toLocaleString(i18n.language)
      : c.notRecorded;
  function apply() {
    const startsAt = start ? new Date(start).toISOString() : undefined;
    const endsAt = end ? new Date(end).toISOString() : undefined;
    const parsed = FleetSiteActivityFilterSchema.safeParse({
      startsAt,
      endsAt,
    });
    setInvalid(!parsed.success);
    if (parsed.success) {
      setFilter(parsed.data);
      if (JSON.stringify(parsed.data) === JSON.stringify(filter))
        void activity.refetch();
    }
  }
  return (
    <main className="space-y-4 p-6">
      <h1 className="text-xl font-semibold">{c.siteActivity}</h1>
      <p>{c.activityPrivacy}</p>
      <p className="text-sm">{c.activityWindow}</p>
      {choices.isPending ? (
        <p>{c.loading}</p>
      ) : choices.isError ? (
        <p role="alert">{c.activityUnavailable}</p>
      ) : (
        <label>
          {c.selectActivitySite}
          <select
            className="block rounded border p-2"
            value={site}
            onChange={(event) => setSite(event.target.value)}
          >
            <option value="">{c.selectActivitySite}</option>
            {choices.data?.sites.map((item) => (
              <option key={item.siteId} value={item.siteId}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="flex flex-wrap gap-3">
        <label>
          {c.activityStart}
          <input
            className="block rounded border p-2"
            type="datetime-local"
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
        </label>
        <label>
          {c.activityEnd}
          <input
            className="block rounded border p-2"
            type="datetime-local"
            value={end}
            onChange={(event) => setEnd(event.target.value)}
          />
        </label>
        <PngPillButton disabled={!authorized} onClick={apply}>
          {c.activityApply}
        </PngPillButton>
        <PngPillButton
          onClick={() => {
            void choices.refetch();
            if (authorized) void activity.refetch();
          }}
        >
          {c.refresh}
        </PngPillButton>
      </div>
      {invalid && <p role="alert">{c.activityUnavailable}</p>}
      {authorized && activity.isPending && <p>{c.loading}</p>}
      {authorized && activity.isError && (
        <p role="alert">{c.activityUnavailable}</p>
      )}
      {data && (
        <>
          <h2>{data.siteName}</h2>
          <p>
            {date(data.window.startsAt)} – {date(data.window.endsAt)}
          </p>
          {!data.records.length && <p>{c.activityEmpty}</p>}
          {data.records.map((record) => (
            <article
              key={record.runId}
              className="space-y-2 rounded border p-3"
            >
              <h3>
                {record.vendorName} · {record.status}
              </h3>
              <p className="text-xs">{record.runId}</p>
              {record.stops.map((stop) => (
                <div key={stop.stopId}>
                  <strong>{stop.kind}</strong>
                  {stop.events.map((event, index) => (
                    <p key={`${event.type}:${index}`}>
                      {event.type} · {c.activityAccepted}:{" "}
                      {date(event.recordedAt)} · {c.activityCaptured}:{" "}
                      {date(event.capturedAt)} · {event.source}
                    </p>
                  ))}
                </div>
              ))}
              {record.loads.map((load) => (
                <p key={load.loadId}>
                  {load.commodity} · {load.quantity} {load.unit} ·{" "}
                  {load.direction} ·{" "}
                  {load.delivered ? c.activityDelivered : c.notRecorded}
                </p>
              ))}
            </article>
          ))}
          {data.unavailableMetrics.map((metric) => (
            <p key={metric} className="text-sm">
              {metric}
            </p>
          ))}
        </>
      )}
    </main>
  );
}
