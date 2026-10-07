import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { FleetRun } from "@workspace/api-zod";
import { fleetClient } from "@/lib/fleet-client";
import { fleetCopy } from "@/lib/fleet-copy";
import { PngPillButton } from "@/components/png-pill-rollover";
export function FleetEtaPanel({
  run,
  identity,
}: {
  run: FleetRun;
  identity: string;
}) {
  const { i18n } = useTranslation();
  const c = fleetCopy(i18n.language);
  const query = useQuery({
    queryKey: ["fleet", identity, "eta", run.id, run.version],
    queryFn: () => fleetClient.eta(run.id),
    enabled: false,
    retry: false,
  });
  const data =
    !query.isError && query.data?.runId === run.id ? query.data : undefined;
  const reasons: Record<string, string> = {
    "fleet.eta_run_inactive": c.etaInactive,
    "fleet.eta_run_paused": c.etaPaused,
    "fleet.eta_location_unavailable": c.etaNoLocation,
    "fleet.eta_next_stop_unavailable": c.etaNoStop,
    "fleet.eta_destination_unavailable": c.etaNoDestination,
    "fleet.eta_context_changed": c.etaChanged,
  };
  return (
    <section className="space-y-2 rounded border p-3">
      <h3>{c.etaTitle}</h3>
      <p className="text-sm">{c.etaBasis}</p>
      <PngPillButton
        disabled={query.isFetching}
        onClick={() => void query.refetch()}
      >
        {c.etaRead}
      </PngPillButton>
      {query.isError && <p role="alert">{c.etaUnavailable}</p>}
      {data && !data.ok && (
        <p role="status">{reasons[data.code] ?? c.etaUnavailable}</p>
      )}
      {data?.ok && (
        <>
          <p>
            {data.siteName} ·{" "}
            {data.durationMinutes.toLocaleString(i18n.language)} {c.etaMinutes}{" "}
            · {data.distanceMiles.toLocaleString(i18n.language)} {c.etaMiles}
          </p>
          <p>
            {c.etaEstimated}:{" "}
            {new Date(data.estimatedAt).toLocaleString(i18n.language)}
          </p>
          <p>
            {c.etaPhone}:{" "}
            {new Date(data.sourceRecordedAt).toLocaleString(i18n.language)} ·{" "}
            {c.etaAccuracy}: {data.sourceAccuracyMeters} m
          </p>
          <p>
            {c.etaProvider}: Mapbox · {c.etaTraffic}:{" "}
            {data.trafficAware ? c.etaYes : c.etaNo} · {c.etaConfidence}:{" "}
            {data.routeConfidence}
          </p>
        </>
      )}
    </section>
  );
}
