import { CsvImport } from "./csv-import";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import {
  createWorkHubOperationId,
  isWorkHubAdmin,
  ownerForUser,
  workHubRequest,
} from "@/lib/work-hub-client";
import BrandPillButton from "@/components/brand-pill-button";
import { HubError } from "./collaboration";
type Row = Record<string, any>;
type ExportStatus = { id: string; dataset: string; format: string; status: "pending" | "running" | "completed" | "failed" | "expired"; createdAt: string; updatedAt: string; rowCount: number | null; byteCount: number | null; expiresAt: string; fileName: string | null; errorCode: string | null };
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
  const { t } = useTranslation();
  const { user } = useAuth();
  const admin = isWorkHubAdmin(user);
  const owner = ownerForUser(user);
  const [dataset, setDataset] = useState("tasks");
  const [format, setFormat] = useState("csv");
  const [expiresAt, setExpiresAt] = useState("");
  const [operationId, setOperationId] = useState(createWorkHubOperationId);
  const [job, setJob] = useState<ExportStatus | null>(null);
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
    mutationFn: () => workHubRequest<ExportStatus>("/exports", { method: "POST", headers: { "x-vndrly-client": "web" }, body: JSON.stringify({ operationId, owner, export: { dataset, format, scope: { selectors: {} } }, expiresAt: new Date(expiresAt).toISOString() }) }),
    onSuccess: (created) => { setJob(created); setOperationId(createWorkHubOperationId()); },
  });
  const exportStatus = useQuery<ExportStatus>({
    queryKey: ["work-hub-export", job?.id, user?.userId, user?.activeMembershipId],
    enabled: Boolean(job?.id),
    queryFn: () => workHubRequest(`/exports/${job!.id}`),
    refetchInterval: (query) => { const status = (query.state.data as ExportStatus | undefined)?.status ?? job?.status ?? ""; return ["pending", "running"].includes(status) ? 1500 : status === "completed" ? 30_000 : false; },
  });
  const shownJob = exportStatus.error ? null : exportStatus.data ?? job;
  return (
    <div className="mt-5 grid gap-5">
      {admin && owner && <section className="rounded-xl border bg-card p-5">
        <h2 className="text-xl font-semibold">
          {t("workHubExports.title")}
        </h2>
        <p className="my-3 text-sm text-muted-foreground">
          {t("workHubExports.description")}
        </p>
        <div className="flex flex-wrap gap-3">
          <select
            aria-label={t("workHubExports.dataset")}
            className="rounded border bg-background px-3"
            value={dataset}
            onChange={(e) => {
              setDataset(e.target.value);
              setFormat("csv");
              setJob(null);
            }}
          >
            <option value="tasks">{t("workHubExports.tasks")}</option>
            <option value="calendar">{t("workHubExports.calendar")}</option>
            <option value="channels">{t("workHubExports.channels")}</option>
          </select>
          <select aria-label={t("workHubExports.format")} className="rounded border bg-background px-3" value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="csv">CSV</option>
            {dataset !== "calendar" && <option value="pdf">PDF</option>}
            {dataset === "calendar" && <option value="ics">ICS</option>}
            {dataset !== "calendar" && <option value="zip">ZIP</option>}
          </select>
          <label className="grid gap-1 text-sm">{t("workHubExports.expiry")}<input aria-label={t("workHubExports.expiry")} type="datetime-local" className="rounded border bg-background px-3" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} /></label>
          <BrandPillButton
            tone="blue"
            disabled={exportData.isPending || !expiresAt}
            onClick={() => exportData.mutate()}
          >
            {t("workHubExports.create")}
          </BrandPillButton>
          <a className="self-center text-sm underline" href="/work-hub/finance">
            Invoice and payroll exports
          </a>
          <a className="self-center text-sm underline" href="/reports">
            Accounting connections & reports
          </a>
        </div>
        <HubError error={exportData.error} />
        {exportStatus.error && <p role="alert" className="mt-3 text-sm">{t("workHubExports.accessChanged")}</p>}
        {shownJob && <div className="mt-3 text-sm" role="status" aria-live="polite">
          <span>{t(`workHubExports.status.${shownJob.status}`)}</span>
          {shownJob.status === "completed" && <a className="ml-3 underline" href={`/api/work-hub/exports/${shownJob.id}/download`}>{t("workHubExports.download")}</a>}
          {shownJob.status === "failed" && <p>{t("workHubExports.failedHelp")}</p>}
          {shownJob.status === "expired" && <p>{t("workHubExports.expiredHelp")}</p>}
        </div>}
      </section>}
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
