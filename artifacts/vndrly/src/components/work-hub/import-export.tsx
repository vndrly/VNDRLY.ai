import { CsvImport } from "./csv-import";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import {
  createWorkHubOperationId,
  isWorkHubAdmin,
  workHubRequest,
} from "@/lib/work-hub-client";
import BrandPillButton from "@/components/brand-pill-button";
import { HubError } from "./collaboration";
import { downloadCsv } from "./csv";
type Row = Record<string, any>;
function SavedImport({
  batch,
  rows,
  onApplied,
}: {
  batch: Row;
  rows: Row[];
  onApplied: () => void;
}) {
  const [operationId] = useState(createWorkHubOperationId);
  const apply = useMutation({
    mutationFn: () =>
      workHubRequest(`/transfers/${batch.id}/apply`, {
        method: "POST",
        body: JSON.stringify({ operationId, confirm: true }),
      }),
    onSuccess: onApplied,
  });
  return (
    <article className="my-3 rounded border p-3">
      <h3 className="font-semibold">
        {batch.errorSummary?.source ?? "CSV import"}
      </h3>
      <p className="text-sm">
        {batch.categories.join(", ")} · {batch.status} ·{" "}
        {new Date(batch.createdAt).toLocaleString()}
      </p>
      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-semibold">
          Review {rows.length} rows
        </summary>
        <div className="mt-3 max-h-64 space-y-2 overflow-auto">
          {rows.map((row) => (
            <div key={row.id} className="rounded border p-2 text-sm">
              <strong>{row.payload.title}</strong>
              <p className="text-xs">
                Source ID: {row.payload.externalId} ·{" "}
                {row.error?.message ?? row.status}
              </p>
              {row.activatedSubjectId && (
                <a
                  className="text-xs underline"
                  href={
                    row.activatedSubjectType === "channel"
                      ? `/work-hub/channels?channel=${row.activatedSubjectId}`
                      : row.activatedSubjectType === "task"
                        ? `/work-hub/tasks?task=${row.activatedSubjectId}`
                        : "/work-hub/files"
                  }
                >
                  Open imported record
                </a>
              )}
            </div>
          ))}
        </div>
        {batch.status === "preview" &&
          rows.some((row) => row.status === "staged") && (
            <div className="mt-3">
              <p className="mb-2 text-xs">
                Confirmation creates ready rows in the recorded company/channel
                destination. Invalid and previously imported rows are skipped.
              </p>
              <BrandPillButton
                tone="green"
                disabled={apply.isPending}
                onClick={() => apply.mutate()}
              >
                Confirm saved preview and import
              </BrandPillButton>
            </div>
          )}
      </details>
      <HubError error={apply.error} />
      {batch.status === "completed_with_errors" && (
        <p className="mt-2 text-xs text-muted-foreground">
          Correct the invalid rows in your CSV and preview it again using the
          same source name and external IDs. Imported rows will be skipped.
        </p>
      )}
    </article>
  );
}
export function ImportExportTools() {
  const { user } = useAuth();
  const admin = isWorkHubAdmin(user);
  const [dataset, setDataset] = useState("tasks");
  const [month, setMonth] = useState(() =>
    new Date().toISOString().slice(0, 7),
  );
  const [downloaded, setDownloaded] = useState(false);
  const history = useQuery<{ batches: Row[]; items: Row[] }>({
    queryKey: [
      "work-hub",
      "import-history",
      user?.userId,
      user?.activeMembershipId,
    ],
    queryFn: () => workHubRequest("/transfers"),
    enabled: admin,
  });
  const exportData = useMutation({
    mutationFn: async () => {
      if (dataset === "tasks") {
        const rows = await workHubRequest<Row[]>("/tasks");
        downloadCsv(
          "vndrly-tasks.csv",
          ["ID", "Title", "Description", "Status", "Due", "Assignee"],
          rows.map((r) => {
            const t = r.item ?? r;
            return [
              t.id,
              t.title,
              t.description,
              t.status,
              t.dueAt,
              t.assigneeUserId,
            ];
          }),
        );
      } else if (dataset === "channels") {
        const rows = await workHubRequest<Row[]>("/channels");
        downloadCsv(
          "vndrly-channels.csv",
          ["ID", "Name", "Visibility", "Created"],
          rows.map((r) => [r.id, r.name, r.visibility, r.createdAt]),
        );
      } else {
        const start = new Date(`${month}-01T00:00:00`),
          end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
        if (Number.isNaN(start.getTime()))
          throw new Error("Choose a calendar month.");
        const data = await workHubRequest<Row>(
          `/calendar?start=${start.toISOString()}&end=${end.toISOString()}`,
        );
        const rows = [
          ...(data.shifts ?? []).map((r: Row) => ({
            ...(r.item ?? r),
            kind: "Shift",
          })),
          ...(data.tasks ?? []).map((r: Row) => ({
            ...(r.item ?? r),
            startsAt: (r.item ?? r).dueAt,
            kind: "Task",
          })),
          ...(data.meetings ?? []).map((r: Row) => ({
            ...r.occurrence,
            title: r.meeting.title,
            kind: "Meeting",
          })),
        ];
        downloadCsv(
          `vndrly-calendar-${month}.csv`,
          ["Type", "ID", "Title", "Starts", "Ends", "Status"],
          rows.map((r) => [
            r.kind,
            r.id,
            r.title,
            r.startsAt,
            r.endsAt,
            r.status,
          ]),
        );
      }
    },
    onSuccess: () => setDownloaded(true),
  });
  return (
    <div className="mt-5 grid gap-5">
      <section className="rounded-xl border bg-card p-5">
        <h2 className="text-xl font-semibold">
          Export your authorized records
        </h2>
        <p className="my-3 text-sm text-muted-foreground">
          Downloads include records visible in your current company context.
          Invoice exports and payment history are in Billing & Payroll.
        </p>
        <div className="flex flex-wrap gap-3">
          <select
            aria-label="Export dataset"
            className="rounded border bg-background px-3"
            value={dataset}
            onChange={(e) => {
              setDataset(e.target.value);
              setDownloaded(false);
            }}
          >
            <option value="tasks">Tasks</option>
            <option value="calendar">Calendar</option>
            <option value="channels">Channel directory</option>
          </select>
          {dataset === "calendar" && (
            <input
              aria-label="Export calendar month"
              type="month"
              className="rounded border bg-background px-3"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          )}
          <BrandPillButton
            tone="blue"
            disabled={exportData.isPending}
            onClick={() => exportData.mutate()}
          >
            Download CSV
          </BrandPillButton>
          <a className="self-center text-sm underline" href="/work-hub/finance">
            Invoice and payroll exports
          </a>
          <a className="self-center text-sm underline" href="/reports">
            Accounting connections & reports
          </a>
        </div>
        <HubError error={exportData.error} />
        {downloaded && (
          <p role="status" className="mt-3 text-sm">
            CSV download started.
          </p>
        )}
      </section>
      {admin && <CsvImport />}
      {admin && (
        <section className="rounded-xl border bg-card p-5">
          <h2 className="text-xl font-semibold">Import history</h2>
          <HubError error={history.error} />
          {history.isLoading && <p role="status">Loading import history…</p>}
          {history.data?.batches.map((batch) => (
            <SavedImport
              key={batch.id}
              batch={batch}
              rows={
                history.data?.items.filter(
                  (item) => item.batchId === batch.id,
                ) ?? []
              }
              onApplied={() => {
                void history.refetch();
              }}
            />
          ))}
          {!history.isLoading && !history.data?.batches.length && (
            <p className="mt-3 text-sm text-muted-foreground">
              No import batches recorded.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
