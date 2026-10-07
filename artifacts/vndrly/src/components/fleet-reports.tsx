import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  FleetReportFilterSchema,
  FleetSavedViewInputSchema,
  type FleetOverview,
  type FleetReportFilter,
  type FleetSavedView,
} from "@workspace/api-zod";
import type { z } from "zod/v4";
import { fleetClient } from "@/lib/fleet-client";
import { fleetCopy } from "@/lib/fleet-copy";
import { PngPillButton } from "@/components/png-pill-rollover";

function localInput(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
export function FleetReportsPanel({
  overview,
  identity,
}: {
  overview: FleetOverview;
  identity: string;
}) {
  const { i18n } = useTranslation();
  const c = fleetCopy(i18n.language);
  const cache = useQueryClient();
  const [fleetId, setFleetId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [filters, setFilters] = useState<FleetReportFilter>({});
  const [name, setName] = useState("");
  const [view, setView] = useState<FleetSavedView | null>(null);
  const [reviewed, setReviewed] = useState<z.infer<
    typeof FleetSavedViewInputSchema
  > | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const report = useQuery({
    queryKey: ["fleet-reports", identity, filters],
    queryFn: () => fleetClient.report(filters),
    retry: false,
  });
  const views = useQuery({
    queryKey: ["fleet-views", identity],
    queryFn: fleetClient.savedViews,
    retry: false,
  });
  const siteIds = [
    ...new Set(
      overview.fleets
        .filter((fleet) => !fleetId || fleet.id === fleetId)
        .flatMap((fleet) => fleet.siteIds),
    ),
  ];
  function siteName(id: number) {
    return (
      overview.runs
        .flatMap((run) => run.labels?.sites ?? [])
        .find((site) => site.siteId === id)?.name ?? `${c.site} ${id}`
    );
  }
  function reviewedFilters() {
    if (
      [startsAt, endsAt].some(
        (value) => value && !Number.isFinite(Date.parse(value)),
      )
    ) {
      setMessage(c.filterInvalid);
      return null;
    }
    const result = FleetReportFilterSchema.safeParse({
      ...(fleetId ? { fleetId } : {}),
      ...(siteId ? { siteId: Number(siteId) } : {}),
      ...(startsAt ? { startsAt: new Date(startsAt).toISOString() } : {}),
      ...(endsAt ? { endsAt: new Date(endsAt).toISOString() } : {}),
    });
    if (!result.success) {
      setMessage(c.filterInvalid);
      return null;
    }
    return result.data;
  }
  function selectView(selected: FleetSavedView | null) {
    setView(selected);
    setReviewed(null);
    setName(selected?.name ?? "");
    const saved = selected?.filters ?? {};
    setFleetId(saved.fleetId ?? "");
    setSiteId(saved.siteId ? String(saved.siteId) : "");
    setStartsAt(localInput(saved.startsAt));
    setEndsAt(localInput(saved.endsAt));
    setFilters(saved);
    setMessage("");
  }
  function review(action: "save" | "archive") {
    const nextFilters = reviewedFilters();
    if (!nextFilters || (action === "archive" && !view)) return;
    const result = FleetSavedViewInputSchema.safeParse({
      operationId: crypto.randomUUID(),
      action,
      ...(view ? { viewId: view.id, expectedVersion: view.version } : {}),
      ...(action === "save" ? { name, filters: nextFilters } : {}),
    });
    if (result.success) {
      setReviewed(result.data);
      setMessage("");
    } else setMessage(c.filterInvalid);
  }
  async function save() {
    if (!reviewed || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const saved = await fleetClient.saveView(reviewed);
      if (saved.lastOperationId !== reviewed.operationId)
        throw new Error("Saved filter operation unavailable");
      setView(saved.archived ? null : saved);
      setReviewed(null);
      setMessage(c.viewSaved);
      await cache.invalidateQueries({ queryKey: ["fleet-views", identity] });
    } catch {
      setMessage(c.viewFailed);
      await cache.invalidateQueries({ queryKey: ["fleet-views", identity] });
    } finally {
      setBusy(false);
    }
  }
  const data = !report.isError ? report.data : undefined;
  const activeViews = views.isError
    ? []
    : (views.data?.views ?? []).filter((item) => !item.archived);
  return (
    <section className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold">{c.reports}</h1>
        <p className="text-sm text-muted-foreground">{c.reportExplanation}</p>
      </header>
      <section
        className="space-y-3 rounded-xl border p-4"
        onChange={() => setReviewed(null)}
      >
        <label className="block">
          {c.savedViews}
          <select
            disabled={busy}
            value={view?.id ?? ""}
            onChange={(event) =>
              selectView(
                activeViews.find((item) => item.id === event.target.value) ??
                  null,
              )
            }
          >
            <option value="">{c.newView}</option>
            {activeViews.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {views.isError && <p role="alert">{c.reportUnavailable}</p>}
        <label className="block">
          {c.fleet}
          <select
            disabled={busy}
            value={fleetId}
            onChange={(event) => {
              setFleetId(event.target.value);
              setSiteId("");
            }}
          >
            <option value="">{c.allFleets}</option>
            {overview.fleets.map((fleet) => (
              <option key={fleet.id} value={fleet.id}>
                {fleet.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          {c.site}
          <select
            disabled={busy}
            value={siteId}
            onChange={(event) => setSiteId(event.target.value)}
          >
            <option value="">{c.all}</option>
            {siteIds.map((id) => (
              <option key={id} value={id}>
                {siteName(id)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          {c.startsAt}
          <input
            disabled={busy}
            type="datetime-local"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
          />
        </label>
        <label className="block">
          {c.endsAt}
          <input
            disabled={busy}
            type="datetime-local"
            value={endsAt}
            onChange={(event) => setEndsAt(event.target.value)}
          />
        </label>
        <PngPillButton
          disabled={busy}
          onClick={() => {
            const next = reviewedFilters();
            if (next) {
              setFilters(next);
              setMessage("");
            }
          }}
        >
          {c.applyFilters}
        </PngPillButton>
        <label className="block">
          {c.viewName}
          <input
            disabled={busy}
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <PngPillButton
          disabled={busy || !name.trim()}
          onClick={() => review("save")}
        >
          {c.reviewSaveView}
        </PngPillButton>
        {view && (
          <PngPillButton disabled={busy} onClick={() => review("archive")}>
            {c.reviewArchiveView}
          </PngPillButton>
        )}
        {reviewed && (
          <div className="rounded border p-3">
            <p>
              {reviewed.action === "archive" ? c.archive : reviewed.name} ·{" "}
              {c.version} {reviewed.expectedVersion ?? c.newView}
            </p>
            {reviewed.filters && (
              <p>
                {overview.fleets.find(
                  (fleet) => fleet.id === reviewed.filters?.fleetId,
                )?.name ?? c.allFleets}{" "}
                ·{" "}
                {reviewed.filters.siteId
                  ? siteName(reviewed.filters.siteId)
                  : c.all}{" "}
                ·{" "}
                {reviewed.filters.startsAt
                  ? new Date(reviewed.filters.startsAt).toLocaleString(
                      i18n.language,
                    )
                  : c.all}{" "}
                —{" "}
                {reviewed.filters.endsAt
                  ? new Date(reviewed.filters.endsAt).toLocaleString(
                      i18n.language,
                    )
                  : c.all}
              </p>
            )}
            <PngPillButton disabled={busy} onClick={() => void save()}>
              {c.saveView}
            </PngPillButton>
          </div>
        )}
      </section>
      {message && <p role="status">{message}</p>}
      <PngPillButton onClick={() => void report.refetch()}>
        {c.refresh}
      </PngPillButton>
      {report.isPending && <p>{c.loading}</p>}
      {report.isError && <p role="alert">{c.reportUnavailable}</p>}
      {data && (
        <section className="space-y-4 rounded-xl border p-4">
          <p>
            {c.source}: {c.reportSource} · {c.updated}:{" "}
            {new Date(data.generatedAt).toLocaleString(i18n.language)}
          </p>
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              [c.runs, data.runCount],
              [c.completedRuns, data.completedRunCount],
              [c.submittedRuns, data.submittedRunCount],
              [c.inspectionExceptions, data.inspectionExceptions],
            ].map(([label, value]) => (
              <p key={label}>
                {label}: <strong>{value}</strong>
              </p>
            ))}
          </div>
          {data.recordedTiming && (
            <section className="space-y-2 rounded border p-3">
              <h2>{c.timingTitle}</h2>
              <p>{c.timingSource}</p>
              {[
                [c.timingEligible, data.recordedTiming.eligibleRunCount],
                [c.timingInvalid, data.recordedTiming.invalidSequenceCount],
                [c.timingElapsed, data.recordedTiming.elapsedMinutes],
                [c.timingPaused, data.recordedTiming.pausedMinutes],
                [c.timingActive, data.recordedTiming.activeMinutes],
                [c.timingStart, data.recordedTiming.plannedStartCount],
                [c.timingLateStart, data.recordedTiming.lateStartCount],
                [
                  c.timingStartOffset,
                  data.recordedTiming.startOffsetTotalMinutes,
                ],
                [c.timingFinish, data.recordedTiming.plannedFinishCount],
                [c.timingLateFinish, data.recordedTiming.lateFinishCount],
                [
                  c.timingFinishOffset,
                  data.recordedTiming.finishOffsetTotalMinutes,
                ],
              ].map(([label, value]) => (
                <p key={label}>
                  {label}: {value}
                </p>
              ))}
            </section>
          )}
          <h2 className="font-semibold">{c.loads}</h2>
          {data.loadTotals.length ? (
            <table className="w-full text-left">
              <thead>
                <tr>
                  <th>{c.title}</th>
                  <th>{c.recordedQuantity}</th>
                  <th>{c.deliveredQuantity}</th>
                </tr>
              </thead>
              <tbody>
                {data.loadTotals.map((total) => (
                  <tr key={`${total.commodity}:${total.unit}`}>
                    <td>{total.commodity}</td>
                    <td>
                      {total.quantity} {total.unit}
                    </td>
                    <td>
                      {total.deliveredQuantity} {total.unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>{c.noTotals}</p>
          )}
          <h2 className="font-semibold">{c.distance}</h2>
          {data.distanceTotals.length ? (
            data.distanceTotals.map((total) => (
              <p key={total.unit}>
                {total.distance} {total.unit}
              </p>
            ))
          ) : (
            <p>{c.noTotals}</p>
          )}
          <h2 className="font-semibold">{c.fuel}</h2>
          {data.fuelTotals === null ? (
            <p>{c.fuelRestricted}</p>
          ) : data.fuelTotals.length ? (
            data.fuelTotals.map((total) => (
              <p key={total.unit}>
                {total.quantity} {total.unit}
              </p>
            ))
          ) : (
            <p>{c.noTotals}</p>
          )}
          <h2 className="font-semibold">{c.unavailableMetrics}</h2>
          {data.unavailableMetrics.map((metric) => (
            <p key={metric.metric}>
              {metric.metric}: {metric.reason}
            </p>
          ))}
        </section>
      )}
    </section>
  );
}
