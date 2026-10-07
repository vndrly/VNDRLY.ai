import { useEffect, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import { MapboxMap } from "@/components/mapbox-map";
import { PngPillButton } from "@/components/png-pill-rollover";
import { fleetClient, fleetErrorMessage } from "@/lib/fleet-client";
import {
  FleetActionFields,
  fleetActionComplete,
} from "@/components/fleet-action-fields";
import { fleetCopy } from "@/lib/fleet-copy";
import { FleetSupportPanel } from "@/components/fleet-support";
import { FleetManagementProjections } from "@/components/fleet-management-projections";
import { FleetSiteActivityPanel } from "@/components/fleet-site-activity";
import { FleetSetupPanel } from "@/components/fleet-setup";
import { FleetPreferences } from "@/components/fleet-preferences";
import { FleetMaintenancePanel } from "@/components/fleet-maintenance";
import { FleetReportsPanel } from "@/components/fleet-reports";
import {
  FleetScheduleFields,
  fleetScheduleDraft,
  parseFleetSchedule,
} from "@/components/fleet-schedule-fields";
import { FleetDraftEditor } from "@/components/fleet-draft-editor";
import { FleetReplacementPanel } from "@/components/fleet-replacement";
import { FleetCargoPanel } from "@/components/fleet-cargo";
import { FleetEvidencePanel } from "@/components/fleet-evidence";
import { FleetEtaPanel } from "@/components/fleet-eta";
import { FleetGateObservationsPanel } from "@/components/fleet-gate-observations";
import { fleetPositions, fleetVisibleRuns } from "@/lib/fleet-view";
import {
  CreateFleetRunSchema,
  type FleetActionInput,
} from "@workspace/api-zod";
import type { z } from "zod/v4";

export default function FleetPage() {
  const { user } = useAuth();
  const [location] = useLocation();
  if (!user) return null;
  if (location === "/fleet/support")
    return (
      <FleetSupportPanel
        key={`${user.userId}:${user.activeMembershipId}`}
        identity={`${user.userId}:${user.activeMembershipId}`}
      />
    );
  if (location === "/fleet/site-activity")
    return (
      <FleetSiteActivityPanel
        key={`${user.userId}:${user.activeMembershipId}:${user.partnerId}`}
        identity={`${user.userId}:${user.activeMembershipId}:${user.partnerId}`}
      />
    );
  return (
    <FleetWorkspace
      key={`${user.userId}:${user.activeMembershipId}:${user.vendorId}:${user.partnerId}`}
      userId={user.userId}
      identity={`${user.userId}:${user.activeMembershipId}:${user.vendorId}:${user.partnerId}`}
    />
  );
}
function FleetWorkspace({
  userId,
  identity,
}: {
  userId: number;
  identity: string;
}) {
  const { i18n } = useTranslation();
  const c = fleetCopy(i18n.language);
  const [location] = useLocation();
  const queryClient = useQueryClient();
  const routeRunId = location.startsWith("/fleet/runs/")
    ? location.split("/")[3]
    : "";
  const routeRun = useQuery({
    queryKey: ["fleet", identity, "run", routeRunId],
    queryFn: () => fleetClient.run(routeRunId),
    enabled: Boolean(routeRunId),
    retry: false,
  });
  const overview = useInfiniteQuery({
    queryKey: ["fleet", identity, "pages"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fleetClient.overviewPage(pageParam),
    getNextPageParam: (page) => page.page?.nextCursor ?? undefined,
    retry: false,
  });
  const latestPage = overview.data?.pages.at(-1);
  const overviewData = latestPage && {
    ...latestPage,
    runs: [
      ...new Map(
        overview
          .data!.pages.flatMap((page) => page.runs)
          .filter((run) => !(routeRun.isError && run.id === routeRunId))
          .concat(routeRun.data && !routeRun.isError ? [routeRun.data] : [])
          .filter((run) =>
            latestPage.fleets.some(
              (fleet) =>
                fleet.id === run.fleetId &&
                run.siteIds.every((siteId) => fleet.siteIds.includes(siteId)),
            ),
          )
          .map((run) => [run.id, run]),
      ).values(),
    ],
    observations: overview.data!.pages.flatMap((page) => page.observations),
  };
  const resources = useQuery({
    queryKey: ["fleet-resources", identity],
    queryFn: fleetClient.resources,
    enabled: Boolean(overviewData?.capabilities.canDispatch),
    retry: false,
  });
  const createRetry = useRef<{
    fingerprint: string;
    input: z.infer<typeof CreateFleetRunSchema>;
  } | null>(null);
  const [fleetId, setFleetId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(
    location.startsWith("/fleet/runs/") ? location.split("/")[3] : "",
  );
  useEffect(() => {
    if (routeRunId) setSelected(routeRunId);
  }, [routeRunId]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [status, setStatus] = useState(
    location.endsWith("/review") ? "submitted_for_review" : "",
  );
  const [pending, setPending] = useState<{
    id: string;
    input: FleetActionInput;
  } | null>(null);
  const [create, setCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [scheduleDraft, setScheduleDraft] = useState(() =>
    fleetScheduleDraft(null),
  );
  const [driver, setDriver] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [trailer, setTrailer] = useState("");
  const [pickup, setPickup] = useState("");
  const [delivery, setDelivery] = useState("");
  const [returnSite, setReturnSite] = useState("");
  const [extraStops, setExtraStops] = useState<
    { kind: "pickup" | "delivery"; siteId: string }[]
  >([]);
  const preferenceApplied = useRef(false);
  useEffect(() => {
    if (!preferenceApplied.current && overviewData) {
      preferenceApplied.current = true;
      const preferred = overviewData.preference?.selectedFleetId;
      if (
        preferred &&
        overviewData.fleets.some((fleet) => fleet.id === preferred)
      )
        setFleetId(preferred);
    }
  }, [overview.data]);
  const [reason, setReason] = useState("");
  if (overview.isPending) return <p className="p-6">{c.loading}</p>;
  if (overview.isError)
    return (
      <div className="p-6">
        <p role="alert">{c.unavailable}</p>
        <PngPillButton onClick={() => void overview.refetch()}>
          {c.refresh}
        </PngPillButton>
      </div>
    );
  const data = overviewData;
  if (
    !data?.enabled ||
    !(
      data.capabilities.canDrive ||
      data.capabilities.canDispatch ||
      data.capabilities.canManage
    )
  )
    return (
      <div className="p-6">
        <p>{c.denied}</p>
        {data?.capabilities.canSetup && <FleetSetupPanel identity={identity} />}
      </div>
    );
  if (location.endsWith("/setup") && data.capabilities.canSetup)
    return (
      <div className="space-y-4 p-6">
        <Link href="/fleet">{c.desk}</Link>
        <FleetSetupPanel identity={identity} />
      </div>
    );
  if (location.endsWith("/settings"))
    return (
      <div className="space-y-4 p-6">
        <Link href="/fleet">{c.desk}</Link>
        <FleetPreferences overview={data} identity={identity} />
      </div>
    );
  if (location.endsWith("/maintenance"))
    return (
      <div className="space-y-4 p-6">
        <Link href="/fleet">{c.workspace}</Link>
        <FleetMaintenancePanel
          overview={data}
          resources={resources.data}
          identity={identity}
          userId={userId}
        />
      </div>
    );
  if (location.endsWith("/reports"))
    return (
      <div className="space-y-4 p-6">
        <Link href="/fleet">{c.workspace}</Link>
        <FleetReportsPanel overview={data} identity={identity} />
      </div>
    );
  const mine =
    location.includes("my-day") ||
    (!data.capabilities.canManage && !data.capabilities.canDispatch);
  const runs = fleetVisibleRuns(
    data,
    userId,
    mine,
    fleetId,
    siteId,
    search,
  ).filter(
    (item) =>
      (!location.endsWith("/history") ||
        ["completed", "cancelled"].includes(item.status)) &&
      (!status || item.status === status),
  );
  const run = runs.find((item) => item.id === selected);
  const observations = fleetPositions(
    data,
    new Set(runs.map((item) => item.id)),
  );
  const candidates = resources.data;
  async function reload() {
    await queryClient.invalidateQueries({ queryKey: ["fleet", identity] });
  }
  async function saveAction() {
    if (
      !pending ||
      busy ||
      !run ||
      pending.id !== run.id ||
      !run.allowedActions.includes(pending.input.action) ||
      !fleetActionComplete(pending.input, run)
    )
      return;
    setBusy(true);
    setNotice("");
    try {
      await fleetClient.action(pending.id, pending.input);
      setPending(null);
      setNotice(c.saved);
      await reload();
    } catch (error) {
      setNotice(fleetErrorMessage(error, c.blocked));
      await reload();
    } finally {
      setBusy(false);
    }
  }
  async function saveRun() {
    if (
      !data ||
      !fleetId ||
      !driver ||
      !vehicle ||
      !pickup ||
      !delivery ||
      extraStops.some((stop) => !stop.siteId) ||
      busy
    )
      return;
    const schedule = parseFleetSchedule(scheduleDraft);
    if (!schedule.valid) {
      setNotice(c.blocked);
      return;
    }
    setBusy(true);
    const fingerprint = JSON.stringify({
      schedule: schedule.schedule,
      fleetId,
      title,
      driver,
      vehicle,
      trailer,
      pickup,
      delivery,
      returnSite,
      extraStops,
    });
    if (createRetry.current?.fingerprint !== fingerprint)
      createRetry.current = {
        fingerprint,
        input: {
          operationId: crypto.randomUUID(),
          fleetId,
          title,
          schedule: schedule.schedule,
          driverUserId: Number(driver),
          vehicleAssetId: vehicle,
          trailerAssetId: trailer || null,
          stops: [
            {
              id: crypto.randomUUID(),
              siteId: Number(pickup),
              kind: "pickup",
              sequence: 0,
            },
            {
              id: crypto.randomUUID(),
              siteId: Number(delivery),
              kind: "delivery",
              sequence: 1,
            },
            ...extraStops.map((stop, index) => ({
              id: crypto.randomUUID(),
              siteId: Number(stop.siteId),
              kind: stop.kind,
              sequence: index + 2,
            })),
            ...(returnSite
              ? [
                  {
                    id: crypto.randomUUID(),
                    siteId: Number(returnSite),
                    kind: "return" as const,
                    sequence: 2 + extraStops.length,
                  },
                ]
              : []),
          ],
        },
      };
    try {
      await fleetClient.create(createRetry.current.input);
      createRetry.current = null;
      setCreate(false);
      setNotice(c.saved);
      await reload();
    } catch (error) {
      setNotice(fleetErrorMessage(error, c.blocked));
    } finally {
      setBusy(false);
    }
  }
  const selectClass = "rounded border bg-background px-3 py-2 text-sm";
  return (
    <main className="space-y-5 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{c.workspace}</h1>
          <p className="text-xs text-muted-foreground">
            Company {data.companyId}
          </p>
          <p className="text-sm text-muted-foreground">{c.subtitle}</p>
        </div>
        <PngPillButton onClick={() => void reload()}>{c.refresh}</PngPillButton>
      </header>
      <nav className="flex flex-wrap gap-4 text-sm" aria-label={c.workspace}>
        {(data.capabilities.canManage || data.capabilities.canDispatch) && (
          <>
            <Link href="/fleet">{c.desk}</Link>
            <Link href="/fleet/dispatch">{c.dispatch}</Link>
          </>
        )}
        {data.capabilities.canDrive && (
          <Link href="/fleet/my-day">{c.myDay}</Link>
        )}
        {data.capabilities.canSetup && (
          <Link href="/fleet/setup">{c.setup}</Link>
        )}
        <Link href="/fleet/equipment">{c.equipment}</Link>
        <Link href="/fleet/drivers">{c.drivers}</Link>
        <Link href="/fleet/readiness">{c.readinessTitle}</Link>
        <Link href="/fleet/costs">{c.costs}</Link>
        {(data.capabilities.canReportDefect ??
          (data.capabilities.canManage || data.capabilities.canDrive)) && (
          <Link href="/fleet/maintenance">{c.maintenance}</Link>
        )}
        <Link href="/work-hub">{c.workHub}</Link>
        <Link href="/fleet/reports">{c.reports}</Link>
        <Link href="/fleet/history">{c.history}</Link>
      </nav>
      <div className="flex flex-wrap gap-3">
        <select
          aria-label={c.fleet}
          className={selectClass}
          value={fleetId}
          onChange={(event) => {
            setFleetId(event.target.value);
            setSiteId("");
            setDriver("");
            setPickup("");
            setDelivery("");
            setReturnSite("");
            setExtraStops([]);
            setSelected("");
            setPending(null);
          }}
        >
          <option value="">
            {c.all} {c.fleet}
          </option>
          {data.fleets.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <select
          aria-label={c.site}
          className={selectClass}
          value={siteId}
          onChange={(event) => {
            setSiteId(event.target.value);
            setSelected("");
            setPending(null);
          }}
        >
          <option value="">
            {c.all} {c.site}
          </option>
          {[
            ...new Set(
              data.fleets
                .filter((item) => !fleetId || item.id === fleetId)
                .flatMap((item) => item.siteIds),
            ),
          ].map((id) => (
            <option key={id} value={id}>
              {c.site} {id}
            </option>
          ))}
        </select>
        <select
          aria-label={c.status}
          className={selectClass}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPending(null);
          }}
        >
          <option value="">
            {c.all} {c.status}
          </option>
          {[...new Set(data.runs.map((item) => item.status))].map((value) => (
            <option key={value} value={value}>
              {value.replaceAll("_", " ")}
            </option>
          ))}
        </select>
        <input
          className={selectClass}
          aria-label={c.search}
          placeholder={c.search}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPending(null);
          }}
        />
        {data.capabilities.canDispatch && (
          <PngPillButton onClick={() => setCreate(!create)}>
            {c.create}
          </PngPillButton>
        )}
      </div>
      {notice && <p role="status">{notice}</p>}
      {["equipment", "drivers", "readiness", "costs"].includes(
        location.split("/")[2],
      ) && (
        <FleetManagementProjections
          section={location.split("/")[2]}
          data={data}
          resources={!resources.isError ? candidates : undefined}
          runs={runs}
          fleetId={fleetId}
          search={search}
        />
      )}
      {location.endsWith("/loads") && (
        <section className="space-y-3 rounded-xl border p-4">
          <h2 className="text-lg font-semibold">{c.loads}</h2>
          <p className="text-sm text-muted-foreground">
            Saved reports and references from authorized runs. Media, scale
            readings and signatures are available only when recorded by a
            connected source.
          </p>
          {runs.flatMap((item) =>
            item.loads.map((load) => (
              <article className="rounded border p-3" key={load.id}>
                <Link href={`/fleet/runs/${item.id}`}>{item.title}</Link>
                <p>
                  {load.commodity} · {load.quantity} {load.unit} ·{" "}
                  {load.manifestReference}
                </p>
                <p>
                  Delivery reference: {load.deliveryReference ?? c.unlinked}
                </p>
                <p className="text-xs">
                  {load.source} · {load.recordedByUserId} · {load.recordedAt}
                </p>
              </article>
            )),
          )}
          {!runs.some((item) => item.loads.length) && <p>{c.noLoads}</p>}
        </section>
      )}
      {location.endsWith("/dispatch") && candidates && (
        <section className="space-y-3 rounded-xl border p-4">
          <h2 className="text-lg font-semibold">Dispatch resources</h2>
          <p className="text-sm">
            Eligibility and assignment conflicts are rechecked when the exact
            change is saved.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <h3>Authorized drivers</h3>
              {candidates.drivers.map((person) => (
                <p key={person.userId}>
                  {person.name} ·{" "}
                  {person.fleetIds
                    .map(
                      (id) =>
                        data.fleets.find((fleet) => fleet.id === id)?.name ??
                        id,
                    )
                    .join(", ")}
                </p>
              ))}
            </div>
            <div>
              <h3>Vehicles and trailers</h3>
              {candidates.equipment.map((asset) => (
                <p key={asset.id}>
                  {asset.name} · {asset.category} · {asset.status} ·{" "}
                  {asset.dispatchable
                    ? "Available for eligibility review"
                    : "Unavailable for dispatch"}
                </p>
              ))}
            </div>
          </div>
        </section>
      )}
      {!mine && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border p-4">
            <p className="text-sm text-muted-foreground">{c.active}</p>
            <strong className="text-2xl">
              {
                runs.filter((item) =>
                  ["dispatched", "acknowledged", "in_progress"].includes(
                    item.status,
                  ),
                ).length
              }
            </strong>
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-sm text-muted-foreground">
              Pending operational review
            </p>
            <strong className="text-2xl">
              {
                runs.filter((item) => item.status === "submitted_for_review")
                  .length
              }
            </strong>
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-sm text-muted-foreground">
              Stale / paused recorded positions
            </p>
            <strong className="text-2xl">
              {
                observations.filter(
                  (point) =>
                    point.freshness === "stale" || point.freshness === "paused",
                ).length
              }
            </strong>
          </div>
        </div>
      )}
      {create && (
        <section className="space-y-3 rounded-xl border p-4">
          <fieldset disabled={busy} className="space-y-3">
            <h2>{c.create}</h2>
            <p className="text-sm">{c.readiness}</p>
            <input
              aria-label={c.title}
              placeholder={c.title}
              className={selectClass}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <FleetScheduleFields
              value={scheduleDraft}
              onChange={setScheduleDraft}
              disabled={busy}
            />
            <select
              aria-label={c.driver}
              className={selectClass}
              value={driver}
              onChange={(e) => setDriver(e.target.value)}
            >
              <option value="">{c.driver}</option>
              {candidates?.drivers
                .filter((d) => d.fleetIds.includes(fleetId))
                .map((d) => (
                  <option key={d.userId} value={d.userId}>
                    {d.name}
                  </option>
                ))}
            </select>
            <select
              aria-label={c.vehicle}
              className={selectClass}
              value={vehicle}
              onChange={(e) => setVehicle(e.target.value)}
            >
              <option value="">{c.vehicle}</option>
              {candidates?.equipment
                .filter(
                  (e) =>
                    e.dispatchable &&
                    (
                      data.fleets.find((fleet) => fleet.id === fleetId)
                        ?.equipmentAssetIds ?? []
                    ).includes(e.id) &&
                    ["vehicle", "truck"].includes(e.category.toLowerCase()),
                )
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
            </select>
            <select
              aria-label={c.trailer}
              className={selectClass}
              value={trailer}
              onChange={(e) => setTrailer(e.target.value)}
            >
              <option value="">
                {c.trailer}: {c.unlinked}
              </option>
              {candidates?.equipment
                .filter(
                  (e) =>
                    e.dispatchable &&
                    (
                      data.fleets.find((fleet) => fleet.id === fleetId)
                        ?.equipmentAssetIds ?? []
                    ).includes(e.id) &&
                    e.category.toLowerCase() === "trailer",
                )
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
            </select>
            {(["pickup", "delivery"] as const).map((kind) => (
              <select
                key={kind}
                aria-label={c[kind]}
                className={selectClass}
                value={kind === "pickup" ? pickup : delivery}
                onChange={(e) =>
                  kind === "pickup"
                    ? setPickup(e.target.value)
                    : setDelivery(e.target.value)
                }
              >
                <option value="">{c[kind]}</option>
                {data.fleets
                  .find((f) => f.id === fleetId)
                  ?.siteIds.map((id) => (
                    <option key={id} value={id}>
                      {c.site} {id}
                    </option>
                  ))}
              </select>
            ))}
            {extraStops.map((stop, index) => (
              <label key={index} className="block">
                Cycle {Math.floor(index / 2) + 2} {stop.kind}
                <select
                  disabled={busy}
                  value={stop.siteId}
                  onChange={(e) =>
                    setExtraStops(
                      extraStops.map((item, position) =>
                        position === index
                          ? { ...item, siteId: e.target.value }
                          : item,
                      ),
                    )
                  }
                >
                  <option value="">Choose site</option>
                  {data.fleets
                    .find((fleet) => fleet.id === fleetId)
                    ?.siteIds.map((id) => (
                      <option key={id} value={id}>
                        {c.site} {id}
                      </option>
                    ))}
                </select>
              </label>
            ))}
            <PngPillButton
              disabled={busy || extraStops.length >= 46}
              onClick={() =>
                setExtraStops([
                  ...extraStops,
                  { kind: "pickup", siteId: "" },
                  { kind: "delivery", siteId: "" },
                ])
              }
            >
              Add hauling cycle
            </PngPillButton>
            {extraStops.length > 0 && (
              <PngPillButton
                disabled={busy}
                onClick={() => setExtraStops(extraStops.slice(0, -2))}
              >
                Remove last cycle
              </PngPillButton>
            )}
            <select
              aria-label="Optional return site"
              className={selectClass}
              value={returnSite}
              onChange={(e) => setReturnSite(e.target.value)}
            >
              <option value="">Optional return site</option>
              {data.fleets
                .find((f) => f.id === fleetId)
                ?.siteIds.map((id) => (
                  <option key={id} value={id}>
                    {c.site} {id}
                  </option>
                ))}
            </select>
            <PngPillButton
              disabled={
                busy ||
                !title ||
                !fleetId ||
                !driver ||
                !vehicle ||
                !pickup ||
                !delivery ||
                extraStops.some((stop) => !stop.siteId)
              }
              onClick={() => void saveRun()}
            >
              {c.submit}
            </PngPillButton>
          </fieldset>
        </section>
      )}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <section className="overflow-hidden rounded-xl border">
          <h2 className="p-3 font-semibold">{c.map}</h2>
          {observations.length ? (
            <MapboxMap
              height={480}
              fitToData
              points={observations.map((point) => ({
                id: point.runId,
                latitude: point.latitude,
                longitude: point.longitude,
                title: `${point.source} · ${point.freshness} · ${point.recordedAt}`,
                onClick: () => {
                  setSelected(point.runId);
                  setPending(null);
                },
              }))}
            />
          ) : (
            <div className="flex h-80 items-center justify-center bg-muted p-6 text-center text-muted-foreground">
              {c.noLocations}
            </div>
          )}
          <p className="p-3 text-xs text-muted-foreground">{c.mapHint}</p>
          <ul className="px-3 text-xs text-muted-foreground">
            {observations.map((point, index) => (
              <li key={`${point.runId}:${index}`}>
                {runs.find((r) => r.id === point.runId)?.title} · {point.source}{" "}
                · {point.freshness} · {point.recordedAt} ·{" "}
                <Link href={`/fleet/runs/${point.runId}`}>{c.openRun}</Link>
              </li>
            ))}
          </ul>
          <p className="px-3 pb-3 text-xs">
            {c.updated}: {data.generatedAt}
          </p>
        </section>
        <section className="space-y-3 rounded-xl border p-4">
          <h2 className="font-semibold">{mine ? c.myRun : c.selected}</h2>
          {!run ? (
            <p>{c.noSelection}</p>
          ) : (
            <>
              <h3 className="text-lg">{run.title}</h3>
              <p>
                {run.status} · {c.version} {run.version}
              </p>
              <p>
                {c.driver}:{" "}
                {candidates?.drivers.find((d) => d.userId === run.driverUserId)
                  ?.name ??
                  run.labels?.driverName ??
                  run.driverUserId}
              </p>
              <p>
                {c.vehicle}:{" "}
                {candidates?.equipment.find((e) => e.id === run.vehicleAssetId)
                  ?.name ??
                  run.labels?.vehicleName ??
                  run.vehicleAssetId}
              </p>
              {run.schedule && (
                <p>
                  {c.plannedHours}:{" "}
                  {new Date(run.schedule.plannedStartAt).toLocaleString(
                    i18n.language,
                    { timeZone: run.schedule.timezone },
                  )}{" "}
                  –{" "}
                  {new Date(run.schedule.plannedEndAt).toLocaleString(
                    i18n.language,
                    { timeZone: run.schedule.timezone },
                  )}{" "}
                  · {run.schedule.timezone}
                </p>
              )}
              {run.canEditDraft === true && (
                <FleetDraftEditor
                  key={run.id}
                  run={run}
                  sites={
                    data.fleets.find((fleet) => fleet.id === run.fleetId)
                      ?.siteIds ?? []
                  }
                  onSaved={reload}
                />
              )}
              <Link href={`/fleet/runs/${run.id}`}>{c.openRun}</Link>
              <p className="text-xs">{c.routeUnavailable}</p>
              <h3>{c.stops}</h3>
              <p>
                {c.trailer}:{" "}
                {run.labels?.trailerName ??
                  candidates?.equipment.find(
                    (asset) => asset.id === run.trailerAssetId,
                  )?.name ??
                  (run.trailerAssetId ? run.trailerAssetId : c.unlinked)}
              </p>
              <p className="text-xs">
                Current stop:{" "}
                {run.currentStopId
                  ? run.stops.find((stop) => stop.id === run.currentStopId)
                      ?.sequence! + 1
                  : "Traveling / not at a stop"}{" "}
                · Visited: {run.visitedStopIds.length}/{run.stops.length}
              </p>
              <ol className="list-decimal pl-5">
                {[...run.stops]
                  .sort((a, b) => a.sequence - b.sequence)
                  .map((stop) => (
                    <li key={stop.id}>
                      {stop.kind} ·{" "}
                      {run.labels?.sites.find(
                        (site) => site.siteId === stop.siteId,
                      )?.name ?? `${c.site} ${stop.siteId}`}
                    </li>
                  ))}
              </ol>
              <h3>Reported meter and fuel records</h3>
              <ul>
                {run.records.map((record) => (
                  <li key={record.id}>
                    {record.kind} · {record.reading ?? record.quantity}{" "}
                    {record.unit} · {record.notes} · {record.source} ·{" "}
                    {record.recordedAt}
                  </li>
                ))}
              </ul>
              <h3>{c.loads}</h3>
              {!run.loads.length && <p>{c.noLoads}</p>}
              <ul>
                {run.loads.map((load) => (
                  <li key={load.id}>
                    {load.commodity} · {load.quantity} {load.unit} ·{" "}
                    {load.manifestReference} ·{" "}
                    {load.transferOut
                      ? `${c.cargoTransferredOut} · ${load.transferOut.otherRunId}`
                      : load.deliveredAt
                        ? `Delivered ${load.deliveredAt}`
                        : "Awaiting delivery"}{" "}
                    {load.transferIn && (
                      <p>
                        {c.cargoTransferredIn} · {load.transferIn.otherRunId}
                      </p>
                    )}
                    · {load.source}
                    {Object.entries(load.manifestValues ?? {}).map(
                      ([id, value]) => (
                        <p key={id}>
                          {run.operationalProfile?.manifestFields.find(
                            (field) => field.id === id,
                          )?.label ?? id}
                          : {value}
                        </p>
                      ),
                    )}
                  </li>
                ))}
              </ul>
              <h3>Driver inspection reports</h3>
              <ul>
                {run.inspections.map((inspection, index) => (
                  <li key={index}>
                    {inspection.outcome} · {inspection.notes} ·{" "}
                    {inspection.recordedAt} · {inspection.source}
                    {inspection.responses?.map((answer) => (
                      <p key={answer.id}>
                        {run.operationalProfile?.inspectionItems.find(
                          (item) => item.id === answer.id,
                        )?.label ?? answer.id}
                        : {answer.outcome} · {answer.notes ?? ""}
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
              {run.linkedTicketId && (
                <Link href={`/tickets/${run.linkedTicketId}`}>
                  {c.ticket} #{run.linkedTicketId}
                </Link>
              )}
              <h3>{c.availableActions}</h3>
              <FleetEtaPanel
                key={`${run.id}:${run.version}`}
                run={run}
                identity={identity}
              />
              <FleetReplacementPanel
                key={run.id}
                run={run}
                identity={identity}
                canDispatch={data.capabilities.canDispatch}
                equipment={(candidates?.equipment ?? []).filter((item) =>
                  (
                    data.fleets.find((fleet) => fleet.id === run.fleetId)
                      ?.equipmentAssetIds ?? []
                  ).includes(item.id),
                )}
                onSaved={reload}
              />
              <FleetCargoPanel
                key={run.id}
                run={run}
                runs={data.runs}
                identity={identity}
                canDispatch={data.capabilities.canDispatch}
                onSaved={reload}
              />
              <FleetEvidencePanel
                key={run.id}
                run={run}
                identity={identity}
                userId={userId}
                canAdd={
                  data.capabilities.canDrive &&
                  run.driverUserId === userId &&
                  ["acknowledged", "in_progress"].includes(run.status)
                }
                onSaved={reload}
              />
              <FleetGateObservationsPanel
                key={run.id}
                run={run}
                identity={identity}
                onSaved={reload}
              />
              <div className="flex flex-wrap gap-2">
                {run.allowedActions.map((action) => (
                  <PngPillButton
                    key={action}
                    disabled={busy}
                    onClick={() => {
                      setReason("");
                      setPending({
                        id: run.id,
                        input: {
                          operationId: crypto.randomUUID(),
                          expectedVersion: run.version,
                          capturedAt: new Date().toISOString(),
                          source: "user_report",
                          action,
                          ...(action === "record_load"
                            ? { loadId: crypto.randomUUID() }
                            : {}),
                        },
                      });
                    }}
                  >
                    {action === "acknowledge"
                      ? c.acknowledge
                      : action === "dispatch"
                        ? c.dispatchRun
                        : action === "cancel"
                          ? c.cancelRun
                          : action === "reassign"
                            ? c.reassign
                            : action.replaceAll("_", " ")}
                  </PngPillButton>
                ))}
              </div>
              {pending?.id === run.id && (
                <div className="space-y-2 rounded border p-3">
                  <p>
                    {c.reviewChange} {pending.input.action} · v
                    {pending.input.expectedVersion}
                  </p>
                  {pending.input.action === "cancel" && (
                    <input
                      disabled={busy}
                      aria-label={c.reason}
                      value={reason}
                      onChange={(e) => {
                        setReason(e.target.value);
                        setPending({
                          ...pending,
                          input: {
                            ...pending.input,
                            operationId: crypto.randomUUID(),
                            reason: e.target.value,
                          },
                        });
                      }}
                    />
                  )}
                  {pending.input.action === "reassign" && (
                    <>
                      <select
                        disabled={busy}
                        aria-label={c.driver}
                        value={pending.input.driverUserId ?? ""}
                        onChange={(e) =>
                          setPending({
                            ...pending,
                            input: {
                              ...pending.input,
                              operationId: crypto.randomUUID(),
                              driverUserId: Number(e.target.value),
                            },
                          })
                        }
                      >
                        <option value="">{c.driver}</option>
                        {candidates?.drivers
                          .filter((d) => d.fleetIds.includes(run.fleetId))
                          .map((d) => (
                            <option key={d.userId} value={d.userId}>
                              {d.name}
                            </option>
                          ))}
                      </select>
                      <select
                        aria-label={c.vehicle}
                        disabled={busy}
                        value={pending.input.vehicleAssetId ?? ""}
                        onChange={(e) =>
                          setPending({
                            ...pending,
                            input: {
                              ...pending.input,
                              operationId: crypto.randomUUID(),
                              vehicleAssetId: e.target.value || undefined,
                            },
                          })
                        }
                      >
                        <option value="">Keep current vehicle</option>
                        {candidates?.equipment
                          .filter(
                            (e) =>
                              e.dispatchable &&
                              (
                                data.fleets.find(
                                  (fleet) => fleet.id === run.fleetId,
                                )?.equipmentAssetIds ?? []
                              ).includes(e.id) &&
                              ["vehicle", "truck"].includes(
                                e.category.toLowerCase(),
                              ),
                          )
                          .map((e) => (
                            <option key={e.id} value={e.id}>
                              {e.name}
                            </option>
                          ))}
                      </select>
                      <select
                        aria-label={c.trailer}
                        disabled={busy}
                        value={
                          pending.input.trailerAssetId === null
                            ? "none"
                            : (pending.input.trailerAssetId ?? "")
                        }
                        onChange={(e) =>
                          setPending({
                            ...pending,
                            input: {
                              ...pending.input,
                              operationId: crypto.randomUUID(),
                              trailerAssetId:
                                e.target.value === "none"
                                  ? null
                                  : e.target.value || undefined,
                            },
                          })
                        }
                      >
                        <option value="">Keep current trailer</option>
                        <option value="none">Remove trailer</option>
                        {candidates?.equipment
                          .filter(
                            (e) =>
                              e.dispatchable &&
                              (
                                data.fleets.find(
                                  (fleet) => fleet.id === run.fleetId,
                                )?.equipmentAssetIds ?? []
                              ).includes(e.id) &&
                              e.category.toLowerCase() === "trailer",
                          )
                          .map((e) => (
                            <option key={e.id} value={e.id}>
                              {e.name}
                            </option>
                          ))}
                      </select>
                    </>
                  )}
                  <FleetActionFields
                    tickets={candidates?.tickets}
                    run={run}
                    input={pending.input}
                    disabled={busy}
                    onChange={(input) =>
                      setPending({
                        ...pending,
                        input: { ...input, operationId: crypto.randomUUID() },
                      })
                    }
                  />
                  <PngPillButton
                    disabled={busy || !fleetActionComplete(pending.input, run)}
                    onClick={() => void saveAction()}
                  >
                    {c.submit}
                  </PngPillButton>
                  <PngPillButton
                    disabled={busy}
                    onClick={() => setPending(null)}
                  >
                    {c.cancel}
                  </PngPillButton>
                </div>
              )}
              <h3>{c.events}</h3>
              <ul className="text-xs">
                {run.events.map((event) => (
                  <li key={event.id}>
                    {event.type.replaceAll("_", " ")} · {c.actor}{" "}
                    {event.actorUserId} · {c.accepted} {event.recordedAt}
                    {event.capturedAt && (
                      <p>
                        {c.captured} {event.capturedAt} · {event.source}
                      </p>
                    )}
                    {["reason", "notes", "decision"].map((key) =>
                      typeof event.details?.[key] === "string" ? (
                        <p key={key}>{String(event.details?.[key])}</p>
                      ) : null,
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
      <section className="rounded-xl border p-4">
        <h2 className="font-semibold">
          {mine ? c.assigned : c.runs} ({runs.length})
        </h2>
        <p className="text-xs text-muted-foreground">
          {c.loadedRuns}: {data.runs.length}
        </p>
        {overview.hasNextPage && (
          <PngPillButton
            disabled={overview.isFetchingNextPage}
            onClick={() => void overview.fetchNextPage()}
          >
            {c.loadMore}
          </PngPillButton>
        )}
        {!runs.length && <p>{mine ? c.noAssigned : c.noRuns}</p>}
        <div className="divide-y">
          {runs.map((item) => (
            <button
              key={item.id}
              className="flex w-full items-center justify-between gap-3 py-3 text-left"
              onClick={() => {
                setSelected(item.id);
                setPending(null);
              }}
              aria-pressed={selected === item.id}
            >
              <span>{item.title}</span>
              <span className="text-sm text-muted-foreground">
                {item.status} · v{item.version}
              </span>
            </button>
          ))}
        </div>
      </section>
      {data.unavailableIntegrations.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {c.unavailableTracking} {data.unavailableIntegrations.join(", ")}
        </p>
      )}
    </main>
  );
}
