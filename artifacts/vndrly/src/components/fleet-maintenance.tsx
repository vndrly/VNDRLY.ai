import { useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  FleetMaintenanceCreateSchema,
  FleetMaintenanceActionSchema,
  type FleetMaintenanceCreate,
  type FleetMaintenanceAction,
  type FleetOverview,
  type FleetResources,
} from "@workspace/api-zod";
import { fleetClient } from "@/lib/fleet-client";
import { fleetCopy } from "@/lib/fleet-copy";
import { PngPillButton } from "@/components/png-pill-rollover";

export function FleetMaintenancePanel({
  overview,
  resources,
  identity,
  userId,
}: {
  overview: FleetOverview;
  resources?: FleetResources;
  identity: string;
  userId: number;
}) {
  const { i18n } = useTranslation();
  const c = fleetCopy(i18n.language);
  const cache = useQueryClient();
  const records = useInfiniteQuery({
    queryKey: ["fleet-maintenance", identity],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fleetClient.maintenance(pageParam),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  const [selectedId, setSelectedId] = useState("");
  const selected = useQuery({
    queryKey: ["fleet-maintenance-detail", identity, selectedId],
    queryFn: () => fleetClient.maintenanceDetail(selectedId),
    enabled: Boolean(selectedId),
    retry: false,
  });
  const [fleetId, setFleetId] = useState("");
  const [runId, setRunId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [kind, setKind] = useState<"defect" | "scheduled_service">("defect");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [actionNotes, setActionNotes] = useState("");
  const [reviewed, setReviewed] = useState<FleetMaintenanceCreate | null>(null);
  const [pendingAction, setPendingAction] = useState<{
    id: string;
    input: FleetMaintenanceAction;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const ownRuns = overview.runs.filter(
    (run) =>
      run.driverUserId === userId &&
      !["completed", "cancelled"].includes(run.status),
  );
  const ownRun = ownRuns.find((run) => run.id === runId);
  function equipmentName(id: string) {
    const directoryName = resources?.equipment.find(
      (asset) => asset.id === id,
    )?.name;
    if (directoryName) return directoryName;
    const assigned = ownRuns.find(
      (run) => run.vehicleAssetId === id || run.trailerAssetId === id,
    );
    return assigned?.vehicleAssetId === id
      ? (assigned.labels?.vehicleName ?? c.vehicle)
      : assigned?.trailerAssetId === id
        ? (assigned.labels?.trailerName ?? c.trailer)
        : id;
  }
  const selectedFleet = overview.fleets.find((fleet) => fleet.id === fleetId);
  const equipment = overview.capabilities.canManage
    ? (resources?.equipment ?? [])
        .filter((asset) => selectedFleet?.equipmentAssetIds.includes(asset.id))
        .map((asset) => ({ id: asset.id, name: asset.name }))
    : ownRun
      ? [
          {
            id: ownRun.vehicleAssetId,
            name: ownRun.labels?.vehicleName ?? c.vehicle,
          },
          ...(ownRun.trailerAssetId
            ? [
                {
                  id: ownRun.trailerAssetId,
                  name: ownRun.labels?.trailerName ?? c.trailer,
                },
              ]
            : []),
        ]
      : [];
  const visible = [
    ...new Map(
      (records.data?.pages.flatMap((page) => page.records) ?? []).map(
        (record) => [record.id, record],
      ),
    ).values(),
  ];
  const record = !selected.isError ? selected.data : undefined;
  async function refresh() {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["fleet-maintenance", identity] }),
      cache.invalidateQueries({
        queryKey: ["fleet-maintenance-detail", identity],
      }),
      cache.invalidateQueries({ queryKey: ["fleet", identity] }),
      cache.invalidateQueries({ queryKey: ["fleet-resources", identity] }),
    ]);
  }
  function review() {
    if (dueAt && !Number.isFinite(Date.parse(dueAt))) return;
    const result = FleetMaintenanceCreateSchema.safeParse({
      operationId: crypto.randomUUID(),
      fleetId: overview.capabilities.canManage ? fleetId : ownRun?.fleetId,
      assetId,
      ...(overview.capabilities.canManage ? {} : { runId: ownRun?.id }),
      kind: overview.capabilities.canManage ? kind : "defect",
      title,
      notes,
      ...(dueAt && overview.capabilities.canManage
        ? { dueAt: new Date(dueAt).toISOString() }
        : {}),
    });
    if (result.success) {
      setReviewed(result.data);
      setMessage("");
    }
  }
  async function saveReport() {
    if (!reviewed || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const saved = await fleetClient.createMaintenance(reviewed);
      if (
        !saved.events.some(
          (event) => event.operationId === reviewed.operationId,
        )
      )
        throw new Error("Saved report operation unavailable");
      setSelectedId(saved.id);
      setReviewed(null);
      setMessage(c.maintenanceSaved);
      await refresh();
    } catch {
      setMessage(c.maintenanceBlocked);
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  function prepareAction(action: FleetMaintenanceAction["action"]) {
    if (!record?.allowedActions.includes(action)) return;
    const result = FleetMaintenanceActionSchema.safeParse({
      operationId: crypto.randomUUID(),
      expectedVersion: record.version,
      action,
      notes: actionNotes,
    });
    if (result.success) setPendingAction({ id: record.id, input: result.data });
  }
  async function saveAction() {
    if (!pendingAction || pendingAction.id !== selectedId || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const saved = await fleetClient.maintenanceAction(
        pendingAction.id,
        pendingAction.input,
      );
      if (
        !saved.events.some(
          (event) => event.operationId === pendingAction.input.operationId,
        )
      )
        throw new Error("Saved maintenance operation unavailable");
      setPendingAction(null);
      setMessage(c.maintenanceSaved);
      await refresh();
    } catch {
      setMessage(c.maintenanceBlocked);
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  const actionLabel = (action: FleetMaintenanceAction["action"]) =>
    action === "cancel"
      ? c.cancelMaintenance
      : action === "release" && !record?.holdId
        ? c.closeService
        : c[action];
  const statusLabel = (status: string) =>
    Object.hasOwn(c, status) ? c[status as keyof typeof c] : status;
  return (
    <section className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold">{c.maintenance}</h1>
        <p className="text-sm text-muted-foreground">
          {c.maintenanceExplanation}
        </p>
        <PngPillButton onClick={() => void refresh()}>
          {c.refresh}
        </PngPillButton>
      </header>
      {(overview.capabilities.canReportDefect ??
        (overview.capabilities.canManage ||
          overview.capabilities.canDrive)) && (
        <section
          className="space-y-3 rounded-xl border p-4"
          onChange={() => setReviewed(null)}
        >
          <h2 className="font-semibold">{c.reportMaintenance}</h2>
          {overview.capabilities.canManage ? (
            <label className="block">
              {c.fleet}
              <select
                disabled={busy}
                value={fleetId}
                onChange={(event) => {
                  setFleetId(event.target.value);
                  setAssetId("");
                }}
              >
                <option value="">{c.fleet}</option>
                {overview.fleets.map((fleet) => (
                  <option key={fleet.id} value={fleet.id}>
                    {fleet.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="block">
              {c.ownRun}
              <select
                disabled={busy}
                value={runId}
                onChange={(event) => {
                  setRunId(event.target.value);
                  setAssetId("");
                }}
              >
                <option value="">{c.ownRun}</option>
                {ownRuns.map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block">
            {c.equipmentSelection}
            <select
              disabled={busy}
              value={assetId}
              onChange={(event) => setAssetId(event.target.value)}
            >
              <option value="">{c.equipmentSelection}</option>
              {equipment.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}
                </option>
              ))}
            </select>
          </label>
          {overview.capabilities.canManage && (
            <label className="block">
              {c.kind}
              <select
                disabled={busy}
                value={kind}
                onChange={(event) => setKind(event.target.value as typeof kind)}
              >
                <option value="defect">{c.defect}</option>
                <option value="scheduled_service">{c.scheduled_service}</option>
              </select>
            </label>
          )}
          <label className="block">
            {c.maintenanceTitle}
            <input
              disabled={busy}
              value={title}
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="block">
            {c.notes}
            <textarea
              disabled={busy}
              value={notes}
              maxLength={2000}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
          {overview.capabilities.canManage && (
            <label className="block">
              {c.dueAt}
              <input
                disabled={busy}
                type="datetime-local"
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
              />
            </label>
          )}
          <PngPillButton
            disabled={
              busy ||
              !assetId ||
              !title.trim() ||
              !notes.trim() ||
              !(overview.capabilities.canManage ? fleetId : ownRun)
            }
            onClick={review}
          >
            {c.reviewMaintenance}
          </PngPillButton>
          {reviewed && (
            <div className="rounded border p-3">
              <p>{c.reviewReport}</p>
              <p>
                {
                  overview.fleets.find((fleet) => fleet.id === reviewed.fleetId)
                    ?.name
                }{" "}
                ·{" "}
                {equipment.find((asset) => asset.id === reviewed.assetId)?.name}{" "}
                · {statusLabel(reviewed.kind)} · {reviewed.title}
              </p>
              <p>{reviewed.notes}</p>
              {reviewed.dueAt && (
                <p>{new Date(reviewed.dueAt).toLocaleString(i18n.language)}</p>
              )}
              <PngPillButton disabled={busy} onClick={() => void saveReport()}>
                {c.saveMaintenance}
              </PngPillButton>
            </div>
          )}
        </section>
      )}
      {message && <p role="status">{message}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-2 rounded-xl border p-4">
          <h2 className="font-semibold">{c.maintenance}</h2>
          {records.isPending && <p>{c.loading}</p>}
          {records.isError ? (
            <p role="alert">{c.maintenanceUnavailable}</p>
          ) : (
            visible.map((item) => (
              <button
                className="block w-full rounded border p-3 text-left"
                key={item.id}
                onClick={() => {
                  setSelectedId(item.id);
                  setPendingAction(null);
                  setActionNotes("");
                }}
              >
                <strong>{item.title}</strong>
                <p>
                  {statusLabel(item.status)} · {c.version} {item.version}
                </p>
              </button>
            ))
          )}
          {!records.isPending && !records.isError && !visible.length && (
            <p>{c.maintenanceEmpty}</p>
          )}
          {records.hasNextPage && (
            <PngPillButton
              disabled={records.isFetchingNextPage}
              onClick={() => void records.fetchNextPage()}
            >
              {c.loadMoreMaintenance}
            </PngPillButton>
          )}
        </section>
        <section className="space-y-3 rounded-xl border p-4">
          {selected.isError && <p role="alert">{c.maintenanceUnavailable}</p>}
          {record ? (
            <>
              <h2 className="font-semibold">{record.title}</h2>
              <p>
                {statusLabel(record.status)} · {c.version} {record.version}
              </p>
              <p>
                {c.equipment}: {equipmentName(record.assetId)}
              </p>
              {record.holdId && (
                <p>
                  {c.hold}: {record.holdId}
                </p>
              )}
              {record.dueAt && (
                <p>
                  {c.dueAt}:{" "}
                  {new Date(record.dueAt).toLocaleString(i18n.language)}
                </p>
              )}
              <label className="block">
                {c.notes}
                <textarea
                  disabled={busy}
                  maxLength={2000}
                  value={actionNotes}
                  onChange={(event) => {
                    setActionNotes(event.target.value);
                    setPendingAction(null);
                  }}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                {record.allowedActions.map((action) => (
                  <PngPillButton
                    key={action}
                    disabled={busy || !actionNotes.trim()}
                    onClick={() => prepareAction(action)}
                  >
                    {actionLabel(action)}
                  </PngPillButton>
                ))}
              </div>
              {!record.allowedActions.length && <p>{c.noMaintenanceActions}</p>}
              {pendingAction?.id === record.id && (
                <div className="rounded border p-3">
                  <p>
                    {actionLabel(pendingAction.input.action)} · {c.version}{" "}
                    {pendingAction.input.expectedVersion}
                  </p>
                  <p>{pendingAction.input.notes}</p>
                  <PngPillButton
                    disabled={busy}
                    onClick={() => void saveAction()}
                  >
                    {c.saveMaintenanceAction}
                  </PngPillButton>
                </div>
              )}
              <h3 className="font-semibold">{c.events}</h3>
              {record.events.map((event, index) => (
                <article
                  className="border-t py-2"
                  key={`${event.operationId}:${index}`}
                >
                  <strong>{statusLabel(event.action)}</strong>
                  <p>{event.notes}</p>
                  <p className="text-xs text-muted-foreground">
                    {event.source} · {event.actorUserId} ·{" "}
                    {new Date(event.recordedAt).toLocaleString(i18n.language)}
                  </p>
                </article>
              ))}
            </>
          ) : (
            !selected.isError && <p>{c.selectMaintenance}</p>
          )}
        </section>
      </div>
    </section>
  );
}
