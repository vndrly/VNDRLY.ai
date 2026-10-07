import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import type {
  FleetOverview,
  FleetResources,
  FleetRun,
} from "@workspace/api-zod";
import { fleetCopy } from "@/lib/fleet-copy";

export function FleetManagementProjections({
  section,
  data,
  resources,
  runs,
  fleetId,
  search,
}: {
  section: string;
  data: FleetOverview;
  resources?: FleetResources;
  runs: FleetRun[];
  fleetId: string;
  search: string;
}) {
  const { i18n } = useTranslation();
  const c = fleetCopy(i18n.language);
  const match = (name: string) =>
    name.toLocaleLowerCase().includes(search.toLocaleLowerCase());
  const fleets = data.fleets.filter(
    (fleet) => !fleetId || fleet.id === fleetId,
  );
  const equipmentIds = new Set(
    fleets.flatMap((fleet) => fleet.equipmentAssetIds),
  );
  const active = (assetId: string) =>
    runs.filter(
      (run) =>
        !["completed", "cancelled"].includes(run.status) &&
        (run.vehicleAssetId === assetId || run.trailerAssetId === assetId),
    );
  return (
    <section className="space-y-3 rounded-xl border p-4">
      {section === "equipment" && (
        <>
          <h2>{c.equipment}</h2>
          <Link href="/work-hub/inventory">{c.openInventory}</Link>
          {data.capabilities.canDispatch ? (
            resources ? (
              resources.equipment
                .filter(
                  (asset) => equipmentIds.has(asset.id) && match(asset.name),
                )
                .map((asset) => (
                  <article key={asset.id} className="rounded border p-3">
                    <h3>
                      {asset.name} · {asset.category}
                    </h3>
                    <p>
                      {asset.status} ·{" "}
                      {asset.dispatchable
                        ? c.availableReview
                        : c.dispatchUnavailable}
                    </p>
                    {active(asset.id).map((run) => (
                      <p key={run.id}>
                        <Link href={`/fleet/runs/${run.id}`}>
                          {run.title} · {run.status}
                        </Link>
                      </p>
                    ))}
                  </article>
                ))
            ) : (
              <p>{c.unavailable}</p>
            )
          ) : (
            runs
              .filter((run) => match(run.labels?.vehicleName ?? run.title))
              .map((run) => (
                <p key={run.id}>
                  <Link href={`/fleet/runs/${run.id}`}>
                    {run.labels?.vehicleName ?? run.vehicleAssetId} ·{" "}
                    {run.labels?.trailerName ?? c.noTrailer} · {run.title}
                  </Link>
                </p>
              ))
          )}
        </>
      )}
      {section === "drivers" && (
        <>
          <h2>{c.drivers}</h2>
          <p>{c.driverDirectoryScope}</p>
          {data.capabilities.canDispatch ? (
            resources ? (
              resources.drivers
                .filter(
                  (driver) =>
                    (!fleetId || driver.fleetIds.includes(fleetId)) &&
                    match(driver.name),
                )
                .map((driver) => (
                  <article className="rounded border p-3" key={driver.userId}>
                    <h3>{driver.name}</h3>
                    <p>
                      {fleets
                        .filter((fleet) => driver.fleetIds.includes(fleet.id))
                        .map((fleet) => fleet.name)
                        .join(", ")}
                    </p>
                    {runs
                      .filter((run) => run.driverUserId === driver.userId)
                      .map((run) => (
                        <p key={run.id}>
                          <Link href={`/fleet/runs/${run.id}`}>
                            {run.title} · {run.status}
                          </Link>
                        </p>
                      ))}
                  </article>
                ))
            ) : (
              <p>{c.unavailable}</p>
            )
          ) : (
            runs
              .filter((run) => match(run.labels?.driverName ?? run.title))
              .map((run) => (
                <p key={run.id}>
                  <Link href={`/fleet/runs/${run.id}`}>
                    {run.labels?.driverName ?? c.assigned} · {run.title}
                  </Link>
                </p>
              ))
          )}
        </>
      )}
      {section === "readiness" && (
        <>
          <h2>{c.readinessTitle}</h2>
          <p>{c.readiness}</p>
          <p>{c.readinessReported}</p>
          {runs.map((run) => (
            <article key={run.id} className="rounded border p-3">
              <Link href={`/fleet/runs/${run.id}`}>
                {run.title} · {run.status}
              </Link>
              <p>
                {c.inspection}:{" "}
                {run.inspections.at(-1)?.outcome ?? c.notRecorded}
              </p>
              <p>
                {c.initialMeter}:{" "}
                {run.records?.filter((record) => record.kind === "meter").at(0)
                  ?.reading ?? c.notRecorded}{" "}
                {run.records?.filter((record) => record.kind === "meter").at(0)
                  ?.unit ?? ""}
              </p>
              <p>
                {c.actions}: {run.allowedActions.join(", ") || c.noActions}
              </p>
            </article>
          ))}
        </>
      )}
      {section === "costs" && (
        <>
          <h2>{c.costs}</h2>
          <p>{c.costsUnavailable}</p>
          <Link href="/fleet/reports">{c.reports}</Link>
        </>
      )}
    </section>
  );
}
