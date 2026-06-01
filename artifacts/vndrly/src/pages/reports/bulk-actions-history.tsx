import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PngPillButton as PillButton } from "@/components/png-pill-rollover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  AlertTriangle,
  Download,
  FileSpreadsheet,
  ListFilter,
  Search,
  Undo2,
} from "lucide-react";
import { GoToPageForm } from "@/components/go-to-page-form";
import { ALLOWED_LINE_TYPES } from "./csv-import-preview";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface VendorOption {
  id: number;
  name: string;
}
interface PartnerOption {
  id: number;
  name: string;
}

export interface QbBulkActionRow {
  id: number;
  kind: "bulk_apply" | "csv_import";
  summary: string;
  snapshotCount: number;
  actorUserId: number | null;
  actorRole: string;
  actorDisplayName: string | null;
  actorUsername: string | null;
  createdAt: string;
  undoneAt: string | null;
  undoneByUserId: number | null;
  undoneByDisplayName: string | null;
  undoneByUsername: string | null;
  hasNewerOverlap: boolean;
  overlappingActionIds: number[];
  // ISO timestamp when this row falls out of the undo retention window
  // (createdAt + retentionDays). Server computes this so the UI doesn't
  // need its own copy of QB_BULK_ACTION_RETENTION_DAYS. The UI gates
  // every "is this row still undoable?" decision on `expiresAt` against
  // the wall clock at render time rather than the server-supplied
  // `isExpired` flag below — the dialog can stay open across the
  // boundary and we don't want a stale flag from the fetch to override
  // the live answer.
  expiresAt: string;
  // True when expiresAt had already passed at the moment the server
  // computed the response. Kept on the type for response-shape
  // accuracy but intentionally not consulted by the UI; see expiresAt.
  isExpired: boolean;
  // True when the row is still inside the retention window but within
  // `expiresSoonDays` of falling out of it. Surfaced from the server
  // (computed against the wall clock at fetch time) but the UI also
  // recomputes it locally from `expiresAt` so the badge stays correct
  // if the dialog is left open across the boundary.
  expiresSoon: boolean;
  // Distinct vendor / partner ids touched by this action's snapshot.
  // Drives the "Show in mapping table" jump in BulkActionsHistoryDialog
  // — the dialog hands these to QbAccountMappingCard so the vendor /
  // partner dropdowns can be narrowed to just the entities the action
  // actually affected, without an extra round-trip for the full
  // snapshot.
  affectedVendorIds: number[];
  affectedPartnerIds: number[];
  // True when at least one snapshot row scoped the change to "all
  // vendors" / "all partners" (vendorId or partnerId was null). The
  // mapping card uses these to decide whether to keep the "All
  // vendors" / "All partners" entry in the dropdown when the bulk-
  // action filter is applied — otherwise we'd surface a scope the
  // action never touched.
  affectedIncludesGlobalVendor: boolean;
  affectedIncludesGlobalPartner: boolean;
}

export interface QbBulkActionsResponse {
  rows: QbBulkActionRow[];
  // Active retention window in days (env-configurable on the server).
  retentionDays: number;
  // How many days before retention expiry we surface the "expires soon"
  // badge. Sourced from QB_BULK_ACTION_EXPIRES_SOON_DAYS on the server
  // and clamped at retentionDays so it can't exceed the window.
  expiresSoonDays: number;
}

// One row from `GET /reports/qb-account-mapping/bulk-actions/cleanup-audit`
// — surfaces the actor, count, and policy snapshot for a single on-demand
// cleanup invocation. Background-worker sweeps and dry-run previews are
// NOT recorded server-side, so every row here is an admin-triggered
// destructive action worth showing to other admins.
export interface QbBulkActionCleanupAuditRow {
  id: number;
  actorUserId: number | null;
  actorRole: string;
  actorDisplayName: string | null;
  actorUsername: string | null;
  deletedCount: number;
  protectedRecent: number;
  retentionDays: number;
  minRetained: number;
  cutoff: string;
  createdAt: string;
}

export interface QbBulkActionCleanupAuditResponse {
  rows: QbBulkActionCleanupAuditRow[];
}

interface QbBulkActionCell {
  vendorId: number | null;
  vendorName: string | null;
  partnerId: number | null;
  partnerName: string | null;
  lineType: string;
  previous: { accountName: string; accountNumber: string | null } | null;
  applied: { accountName: string; accountNumber: string | null };
}

interface QbBulkActionDetail {
  id: number;
  kind: "bulk_apply" | "csv_import";
  summary: string;
  actorUserId: number | null;
  actorRole: string;
  actorDisplayName: string | null;
  actorUsername: string | null;
  createdAt: string;
  undoneAt: string | null;
  undoneByUserId: number | null;
  undoneByDisplayName: string | null;
  undoneByUsername: string | null;
  snapshotCount: number;
  offset: number;
  limit: number;
  cells: QbBulkActionCell[];
}

interface QbBulkActionDownload {
  id: number;
  downloadedAt: string;
  downloadedByUserId: number | null;
  downloadedByDisplayName: string | null;
  downloadedByUsername: string | null;
  userRole: string;
}

interface QbBulkActionDownloadsResponse {
  bulkActionId: number;
  downloadCount: number;
  downloads: QbBulkActionDownload[];
}

export interface BulkActionsHistoryDialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onAfterUndo: () => void;
  /** Invoked when the admin clicks the per-row "Show in mapping table"
   *  control. The parent card is expected to apply a filter narrowing
   *  the mapping view to the vendors/partners snapshotted by the row,
   *  and to close the dialog. Optional so callers that don't render a
   *  mapping table (e.g. focused tests) can omit it; the control is
   *  hidden when it isn't provided. */
  onShowInMappingTable?: (row: QbBulkActionRow) => void;
}

function actorDisplay(row: QbBulkActionRow): string {
  return (
    row.actorDisplayName ?? row.actorUsername ?? row.actorRole ?? "—"
  );
}

// Mirrors `actorDisplay` for cleanup-audit rows so the UI stays
// consistent with the bulk-actions table when an actor's user record is
// deleted (FK is `set null` on both tables): we fall back to display
// name → username → role → em-dash. Background-worker sweeps are
// recorded with `actorUserId = null` + `actorRole = "system"` (Task #809);
// surface those as "System (scheduled)" so admins can tell scheduled
// sweeps from on-demand admin runs at a glance.
function cleanupActorDisplay(
  row: QbBulkActionCleanupAuditRow,
  systemLabel: string,
): string {
  if (row.actorUserId == null && row.actorRole === "system") {
    return systemLabel;
  }
  return (
    row.actorDisplayName ?? row.actorUsername ?? row.actorRole ?? "—"
  );
}

function undoneByDisplay(row: QbBulkActionRow): string {
  return (
    row.undoneByDisplayName ?? row.undoneByUsername ?? "—"
  );
}

/** Modal that shows every recent bulk-apply / CSV-import action, with
 * filters by actor + date range, client-side pagination, and per-row
 * Undo. Undoing an action whose cells have been re-touched by a newer
 * non-undone action prompts an extra "are you sure?" dialog so admins
 * understand they're replaying an older snapshot. */
export function BulkActionsHistoryDialog({
  open,
  onOpenChange,
  onAfterUndo,
  onShowInMappingTable,
}: BulkActionsHistoryDialogProps): ReactElement {
  const { t } = useTranslation();
  const [rows, setRows] = useState<QbBulkActionRow[] | null>(null);
  // Active retention window in days (sourced from server; mirrors the
  // QB_BULK_ACTION_RETENTION_DAYS env var). Drives the per-row "Undo
  // available for N days" copy and the dialog header note.
  const [retentionDays, setRetentionDays] = useState<number | null>(null);
  // Days-of-headroom that count as "expires soon" (mirrors
  // QB_BULK_ACTION_EXPIRES_SOON_DAYS on the server). Used to recompute
  // the badge locally so it stays accurate if the dialog is left open
  // across the boundary, and to render the threshold in the badge tooltip.
  const [expiresSoonDays, setExpiresSoonDays] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [actorQuery, setActorQuery] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [kindFilter, setKindFilter] = useState<
    "all" | "bulk_apply" | "csv_import"
  >("all");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "undone"
  >("all");
  const [page, setPage] = useState(0);
  const [undoTargetId, setUndoTargetId] = useState<number | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [confirmRow, setConfirmRow] = useState<QbBulkActionRow | null>(null);
  const [detailRow, setDetailRow] = useState<QbBulkActionRow | null>(null);
  // On-demand cleanup audit rows (admin "Clean up old snapshots" runs).
  // Loaded alongside the bulk-actions list so admins can see who pruned
  // snapshots and when, in the same dialog. We deliberately keep its
  // loading/error state separate from the main `loading`/`err` so a
  // failure to load this small section doesn't block the primary table.
  const [cleanupAudit, setCleanupAudit] = useState<
    QbBulkActionCleanupAuditRow[] | null
  >(null);
  const [cleanupAuditError, setCleanupAuditError] = useState<string | null>(
    null,
  );
  const PAGE_SIZE = 25;

  const reload = useCallback(() => {
    setLoading(true);
    setErr(null);
    fetch(
      `${API_BASE}/api/reports/qb-account-mapping/bulk-actions?limit=100`,
      { credentials: "include" },
    )
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j: QbBulkActionsResponse) => {
        setRows(Array.isArray(j.rows) ? j.rows : []);
        if (typeof j.retentionDays === "number") {
          setRetentionDays(j.retentionDays);
        }
        if (typeof j.expiresSoonDays === "number") {
          setExpiresSoonDays(j.expiresSoonDays);
        }
      })
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false));
    // Fire the cleanup-audit fetch in parallel — the section is
    // independent of the main table, so we don't gate one on the other.
    setCleanupAuditError(null);
    fetch(
      `${API_BASE}/api/reports/qb-account-mapping/bulk-actions/cleanup-audit?limit=10`,
      { credentials: "include" },
    )
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as QbBulkActionCleanupAuditResponse;
      })
      .then((j) => {
        setCleanupAudit(Array.isArray(j.rows) ? j.rows : []);
      })
      .catch((e: Error) => {
        setCleanupAuditError(e.message);
        setCleanupAudit(null);
      });
  }, []);

  // Load on open and reset filter state so the dialog always opens
  // fresh; preserves filters across reloads triggered by undo.
  useEffect(() => {
    if (open) {
      reload();
      setPage(0);
    }
  }, [open, reload]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = actorQuery.trim().toLowerCase();
    const fromMs = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null;
    // Make `to` inclusive of the picked day by reading it as 23:59:59.
    const toMs = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : null;
    const nowMs = Date.now();
    return rows.filter((r) => {
      if (kindFilter !== "all" && r.kind !== kindFilter) return false;
      if (statusFilter !== "all") {
        // "Active" = neither undone nor past its retention/expiry window
        // (matches the rows that still surface an Undo button). "Undone"
        // = the action was rolled back. Expired-but-not-undone rows are
        // intentionally hidden from both narrowed views since they no
        // longer need attention; they remain visible under "All".
        const isUndone = r.undoneAt != null;
        const isExpired = new Date(r.expiresAt).getTime() <= nowMs;
        if (statusFilter === "undone" && !isUndone) return false;
        if (statusFilter === "active" && (isUndone || isExpired)) return false;
      }
      if (q) {
        const haystack = [
          r.actorDisplayName ?? "",
          r.actorUsername ?? "",
          r.actorRole ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      const ts = new Date(r.createdAt).getTime();
      if (fromMs != null && ts < fromMs) return false;
      if (toMs != null && ts > toMs) return false;
      return true;
    });
  }, [rows, actorQuery, fromDate, toDate, kindFilter, statusFilter]);

  // Reset to page 0 whenever the filter changes so paginators don't
  // strand the user on a now-empty page.
  useEffect(() => {
    setPage(0);
  }, [actorQuery, fromDate, toDate, kindFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const visible = filtered.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE,
  );

  function clearFilters(): void {
    setActorQuery("");
    setFromDate("");
    setToDate("");
    setKindFilter("all");
    setStatusFilter("all");
  }

  async function performUndo(row: QbBulkActionRow): Promise<void> {
    setUndoTargetId(row.id);
    setUndoing(true);
    setErr(null);
    try {
      const r = await fetch(
        `${API_BASE}/api/reports/qb-account-mapping/bulk-actions/${row.id}/undo`,
        { method: "POST", credentials: "include" },
      );
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      reload();
      onAfterUndo();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setUndoing(false);
      setUndoTargetId(null);
      setConfirmRow(null);
    }
  }

  function requestUndo(row: QbBulkActionRow): void {
    if (row.hasNewerOverlap) {
      setConfirmRow(row);
    } else {
      void performUndo(row);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-w-4xl"
          data-testid="dialog-bulk-actions-history"
        >
          <DialogHeader>
            <DialogTitle>
              {t("reports.qbMapping.bulkActionsHistory.title")}
            </DialogTitle>
            <DialogDescription>
              {t("reports.qbMapping.bulkActionsHistory.description")}
              {retentionDays != null && (
                <>
                  {" "}
                  <span data-testid="text-history-retention-note">
                    {t(
                      "reports.qbMapping.bulkActionsHistory.retentionNote",
                      { count: retentionDays },
                    )}
                  </span>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="bulk-history-actor" className="text-xs">
                {t("reports.qbMapping.bulkActionsHistory.filter.actor")}
              </Label>
              <Input
                id="bulk-history-actor"
                value={actorQuery}
                onChange={(e) => setActorQuery(e.target.value)}
                placeholder={t(
                  "reports.qbMapping.bulkActionsHistory.filter.actor",
                )}
                className="w-56"
                data-testid="input-history-actor"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="bulk-history-from" className="text-xs">
                {t("reports.qbMapping.bulkActionsHistory.filter.from")}
              </Label>
              <Input
                id="bulk-history-from"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-40"
                data-testid="input-history-from"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="bulk-history-to" className="text-xs">
                {t("reports.qbMapping.bulkActionsHistory.filter.to")}
              </Label>
              <Input
                id="bulk-history-to"
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-40"
                data-testid="input-history-to"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="bulk-history-kind" className="text-xs">
                {t("reports.qbMapping.bulkActionsHistory.filter.kind")}
              </Label>
              <Select
                value={kindFilter}
                onValueChange={(v) =>
                  setKindFilter(v as "all" | "bulk_apply" | "csv_import")
                }
              >
                <SelectTrigger
                  id="bulk-history-kind"
                  className="w-44"
                  data-testid="select-history-kind"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    value="all"
                    data-testid="select-history-kind-all"
                  >
                    {t("reports.qbMapping.bulkActionsHistory.filter.kindAll")}
                  </SelectItem>
                  <SelectItem
                    value="bulk_apply"
                    data-testid="select-history-kind-bulk_apply"
                  >
                    {t("reports.qbMapping.bulkActionsHistory.kind.bulk_apply")}
                  </SelectItem>
                  <SelectItem
                    value="csv_import"
                    data-testid="select-history-kind-csv_import"
                  >
                    {t("reports.qbMapping.bulkActionsHistory.kind.csv_import")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="bulk-history-status" className="text-xs">
                {t("reports.qbMapping.bulkActionsHistory.filter.status")}
              </Label>
              <Select
                value={statusFilter}
                onValueChange={(v) =>
                  setStatusFilter(v as "all" | "active" | "undone")
                }
              >
                <SelectTrigger
                  id="bulk-history-status"
                  className="w-44"
                  data-testid="select-history-status"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    value="all"
                    data-testid="select-history-status-all"
                  >
                    {t("reports.qbMapping.bulkActionsHistory.filter.statusAll")}
                  </SelectItem>
                  <SelectItem
                    value="active"
                    data-testid="select-history-status-active"
                  >
                    {t(
                      "reports.qbMapping.bulkActionsHistory.filter.statusActive",
                    )}
                  </SelectItem>
                  <SelectItem
                    value="undone"
                    data-testid="select-history-status-undone"
                  >
                    {t(
                      "reports.qbMapping.bulkActionsHistory.filter.statusUndone",
                    )}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(actorQuery ||
              fromDate ||
              toDate ||
              kindFilter !== "all" ||
              statusFilter !== "all") && (
              <PillButton
                color="image"
                onClick={clearFilters}
                data-testid="button-history-clear-filters"
              >
                {t("reports.qbMapping.bulkActionsHistory.filter.clear")}
              </PillButton>
            )}
            <span
              className="ml-auto text-xs text-muted-foreground"
              data-testid="text-history-count"
            >
              {t("reports.qbMapping.bulkActionsHistory.showingCount", {
                visible: filtered.length,
                total: rows?.length ?? 0,
              })}
            </span>
          </div>
          {err && (
            <p
              className="text-sm text-destructive"
              data-testid="text-history-error"
            >
              {err}
            </p>
          )}
          {loading && (
            <p className="text-sm text-muted-foreground">
              {t("common.loading")}
            </p>
          )}
          {!loading && rows && rows.length === 0 && (
            <p
              className="text-sm text-muted-foreground"
              data-testid="text-history-empty"
            >
              {t("reports.qbMapping.bulkActionsHistory.empty")}
            </p>
          )}
          {!loading && rows && rows.length > 0 && filtered.length === 0 && (
            <p
              className="text-sm text-muted-foreground"
              data-testid="text-history-no-results"
            >
              {t("reports.qbMapping.bulkActionsHistory.noResults")}
            </p>
          )}
          {!loading && visible.length > 0 && (
            <div className="overflow-x-auto max-h-[55vh]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      {t("reports.qbMapping.bulkActionsHistory.col.when")}
                    </TableHead>
                    <TableHead>
                      {t("reports.qbMapping.bulkActionsHistory.col.actor")}
                    </TableHead>
                    <TableHead>
                      {t("reports.qbMapping.bulkActionsHistory.col.kind")}
                    </TableHead>
                    <TableHead>
                      {t("reports.qbMapping.bulkActionsHistory.col.summary")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("reports.qbMapping.bulkActionsHistory.col.cells")}
                    </TableHead>
                    <TableHead>
                      {t("reports.qbMapping.bulkActionsHistory.col.status")}
                    </TableHead>
                    <TableHead className="text-right" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((row) => {
                    const isUndone = row.undoneAt != null;
                    const busy = undoTargetId === row.id && undoing;
                    // Active (non-undone) rows that aren't yet expired
                    // are the only ones we offer Undo on. Recompute
                    // expiry from `expiresAt` against the wall clock at
                    // render time rather than trusting `row.isExpired`
                    // — the dialog can stay open across the expiry
                    // boundary and we don't want a still-clickable
                    // Undo button on a snapshot the cleanup worker is
                    // about to prune.
                    const expiresAtMs = new Date(row.expiresAt).getTime();
                    const isExpired = expiresAtMs <= Date.now();
                    const daysRemaining = Math.max(
                      0,
                      Math.ceil(
                        (expiresAtMs - Date.now()) / (24 * 60 * 60 * 1000),
                      ),
                    );
                    // Recompute the "expires soon" flag locally from
                    // `expiresAt` rather than trusting the server's
                    // `row.expiresSoon`. Same reason we recompute
                    // isExpired: the dialog can stay open across the
                    // expiry boundary, and we want the badge to drop
                    // off (or appear) as the wall clock advances. The
                    // threshold is sourced from the server's
                    // `expiresSoonDays` so admin reconfiguration is
                    // honored without redeploys.
                    const expiresSoon =
                      !isUndone &&
                      !isExpired &&
                      expiresSoonDays != null &&
                      expiresSoonDays > 0 &&
                      daysRemaining <= expiresSoonDays;
                    return (
                      <TableRow
                        key={row.id}
                        data-testid={`row-history-${row.id}`}
                      >
                        <TableCell className="text-xs whitespace-nowrap">
                          {new Date(row.createdAt).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-sm">
                          {actorDisplay(row)}
                          <div className="text-xs text-muted-foreground">
                            {row.actorRole}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {t(
                              `reports.qbMapping.bulkActionsHistory.kind.${row.kind}`,
                            )}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {row.summary}
                          {row.hasNewerOverlap && !isUndone && (
                            <div
                              className="text-xs text-amber-700 mt-0.5 flex items-center gap-1"
                              data-testid={`text-overlap-${row.id}`}
                            >
                              <AlertTriangle className="h-3 w-3" />
                              {t(
                                "reports.qbMapping.bulkActionsHistory.overlapWarningShort",
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell
                          className="text-right text-sm"
                          data-testid={`cell-snapshot-count-${row.id}`}
                        >
                          {row.snapshotCount}
                        </TableCell>
                        <TableCell className="text-xs">
                          {isUndone ? (
                            <span
                              className="text-muted-foreground"
                              data-testid={`status-undone-${row.id}`}
                            >
                              {t(
                                "reports.qbMapping.bulkActionsHistory.status.undoneBy",
                                {
                                  actor: undoneByDisplay(row),
                                  when: row.undoneAt
                                    ? new Date(
                                        row.undoneAt,
                                      ).toLocaleString()
                                    : "",
                                },
                              )}
                            </span>
                          ) : isExpired ? (
                            <span
                              className="text-muted-foreground"
                              data-testid={`status-expired-${row.id}`}
                              title={t(
                                "reports.qbMapping.bulkActionsHistory.status.expiredTitle",
                                {
                                  when: new Date(
                                    row.expiresAt,
                                  ).toLocaleString(),
                                },
                              )}
                            >
                              {t(
                                "reports.qbMapping.bulkActionsHistory.status.expired",
                              )}
                            </span>
                          ) : (
                            <div className="flex flex-col">
                              <div className="flex items-center gap-1">
                                <span
                                  className="font-medium text-emerald-700"
                                  data-testid={`status-active-${row.id}`}
                                >
                                  {t(
                                    "reports.qbMapping.bulkActionsHistory.status.active",
                                  )}
                                </span>
                                {expiresSoon && (
                                  <Badge
                                    variant="outline"
                                    className="border-amber-300 bg-amber-50 text-amber-800 text-[10px] px-1.5 py-0 leading-4"
                                    data-testid={`badge-expires-soon-${row.id}`}
                                    title={t(
                                      "reports.qbMapping.bulkActionsHistory.status.expiresSoonTitle",
                                      {
                                        count: daysRemaining,
                                        when: new Date(
                                          row.expiresAt,
                                        ).toLocaleString(),
                                      },
                                    )}
                                  >
                                    <AlertTriangle className="h-3 w-3 mr-0.5" />
                                    {t(
                                      "reports.qbMapping.bulkActionsHistory.status.expiresSoon",
                                      { count: daysRemaining },
                                    )}
                                  </Badge>
                                )}
                              </div>
                              <span
                                className="text-muted-foreground"
                                data-testid={`text-undo-window-${row.id}`}
                                title={new Date(
                                  row.expiresAt,
                                ).toLocaleString()}
                              >
                                {t(
                                  "reports.qbMapping.bulkActionsHistory.status.undoWindow",
                                  { count: daysRemaining },
                                )}
                              </span>
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <PillButton
                              color="image"
                              onClick={() => setDetailRow(row)}
                              data-testid={`button-view-details-${row.id}`}
                            >
                              <Search className="h-3 w-3 mr-1" />
                              {t(
                                "reports.qbMapping.bulkActionsHistory.viewDetails",
                              )}
                            </PillButton>
                            {/* "Show in mapping table" closes the dialog
                                and asks the parent card to narrow its
                                vendor/partner dropdowns to the entities
                                this action snapshotted. We hide the
                                control on rows where the snapshot didn't
                                touch any specific vendor or partner —
                                that would resolve to "show all", which
                                is just the default scope and not a
                                useful jump. The control also hides when
                                the parent didn't wire the callback (see
                                prop docs). */}
                            {onShowInMappingTable &&
                              (row.affectedVendorIds.length > 0 ||
                                row.affectedPartnerIds.length > 0 ||
                                row.affectedIncludesGlobalVendor ||
                                row.affectedIncludesGlobalPartner) && (
                                <PillButton
                                  color="image"
                                  onClick={() => onShowInMappingTable(row)}
                                  data-testid={`button-show-in-mapping-${row.id}`}
                                >
                                  <ListFilter className="h-3 w-3 mr-1" />
                                  {t(
                                    "reports.qbMapping.bulkActionsHistory.showInMappingTable",
                                  )}
                                </PillButton>
                              )}
                            {!isUndone && !isExpired && (
                              <PillButton
                                color={row.hasNewerOverlap ? "image" : "blue"}
                                disabled={busy}
                                onClick={() => requestUndo(row)}
                                data-testid={`button-undo-${row.id}`}
                              >
                                <Undo2 className="h-3 w-3 mr-1" />
                                {busy
                                  ? t("reports.qbMapping.undoing")
                                  : t("reports.qbMapping.undo")}
                              </PillButton>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          {/* On-demand cleanup audit — small section listing recent
              admin "Clean up old snapshots" runs. Renders below the
              bulk-actions table so admins reviewing this dialog can also
              see who pruned the snapshot history and when. Auto-runs by
              the 24h worker are not recorded server-side. */}
          <div
            className="border-t pt-3 mt-2 space-y-2"
            data-testid="section-cleanup-audit"
          >
            <div className="flex items-baseline justify-between gap-2">
              <h4 className="text-sm font-medium">
                {t("reports.qbMapping.cleanup.auditHeading")}
              </h4>
              <p className="text-xs text-muted-foreground">
                {t("reports.qbMapping.cleanup.auditDescription")}
              </p>
            </div>
            {/* Download the FULL audit log as CSV (server bypasses the
                10-row inline `?limit` when ?format=csv is set) so admins
                can ship the complete cleanup history off for compliance
                review. Disabled while the section is still loading or
                when there's nothing to export yet, mirroring the
                bulk-action details download behaviour. */}
            <div className="flex items-center justify-end">
              <a
                href={`${API_BASE}/api/reports/qb-account-mapping/bulk-actions/cleanup-audit?format=csv`}
                download
                aria-disabled={
                  cleanupAudit == null || cleanupAudit.length === 0
                }
                onClick={(e) => {
                  if (cleanupAudit == null || cleanupAudit.length === 0) {
                    e.preventDefault();
                  }
                }}
                data-testid="link-cleanup-audit-download-csv"
              >
                <PillButton
                  color="image"
                  disabled={
                    cleanupAudit == null || cleanupAudit.length === 0
                  }
                >
                  <FileSpreadsheet className="h-4 w-4 mr-1" />
                  {t("reports.qbMapping.cleanup.auditDownloadCsv")}
                </PillButton>
              </a>
            </div>
            {cleanupAuditError != null && (
              <p
                className="text-sm text-destructive"
                data-testid="text-cleanup-audit-error"
              >
                {t("reports.qbMapping.cleanup.auditError", {
                  msg: cleanupAuditError,
                })}
              </p>
            )}
            {cleanupAudit != null && cleanupAudit.length === 0 && (
              <p
                className="text-xs text-muted-foreground"
                data-testid="text-cleanup-audit-empty"
              >
                {t("reports.qbMapping.cleanup.auditEmpty")}
              </p>
            )}
            {cleanupAudit != null && cleanupAudit.length > 0 && (
              <div className="overflow-x-auto max-h-[30vh]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        {t("reports.qbMapping.cleanup.auditCol.when")}
                      </TableHead>
                      <TableHead>
                        {t("reports.qbMapping.cleanup.auditCol.actor")}
                      </TableHead>
                      <TableHead className="text-right">
                        {t("reports.qbMapping.cleanup.auditCol.deleted")}
                      </TableHead>
                      <TableHead>
                        {t("reports.qbMapping.cleanup.auditCol.policy")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cleanupAudit.map((row) => (
                      <TableRow
                        key={row.id}
                        data-testid={`row-cleanup-audit-${row.id}`}
                      >
                        <TableCell className="text-xs whitespace-nowrap">
                          {new Date(row.createdAt).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-sm">
                          {cleanupActorDisplay(
                            row,
                            t("reports.qbMapping.cleanup.systemScheduled"),
                          )}
                          <div className="text-xs text-muted-foreground">
                            {row.actorRole}
                          </div>
                        </TableCell>
                        <TableCell
                          className="text-right text-sm"
                          data-testid={`cell-cleanup-audit-deleted-${row.id}`}
                        >
                          {t("reports.qbMapping.cleanup.auditDeleted", {
                            count: row.deletedCount,
                          })}
                        </TableCell>
                        <TableCell
                          className="text-xs text-muted-foreground"
                          data-testid={`cell-cleanup-audit-policy-${row.id}`}
                        >
                          {t("reports.qbMapping.cleanup.auditPolicy", {
                            days: row.retentionDays,
                            kept: row.minRetained,
                          })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
          <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between">
            <span
              className="text-xs text-muted-foreground"
              data-testid="text-history-page"
            >
              {t("reports.qbMapping.bulkActionsHistory.pageOf", {
                page: safePage + 1,
                total: totalPages,
              })}
            </span>
            <div className="flex items-center gap-2">
              <PillButton
                color="image"
                disabled={safePage === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                data-testid="button-history-prev"
              >
                {t("reports.qbMapping.bulkActionsHistory.prev")}
              </PillButton>
              <PillButton
                color="blue"
                disabled={safePage >= totalPages - 1}
                onClick={() =>
                  setPage((p) => Math.min(totalPages - 1, p + 1))
                }
                data-testid="button-history-next"
              >
                {t("reports.qbMapping.bulkActionsHistory.next")}
              </PillButton>
              {/*
                The bulk-actions history table tracks `page` 0-indexed
                internally, but admins type 1-indexed page numbers, so we
                translate `target` (1..totalPages) to a 0-indexed setPage.
                `disabled={loading}` matches the audit-log and details
                pagers so the jumper greys out during refetches too.
              */}
              <GoToPageForm
                totalPages={totalPages}
                disabled={loading}
                onGo={(target) => setPage(target - 1)}
                testIdPrefix="history"
              />
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={confirmRow != null}
        onOpenChange={(next) => {
          if (!next) setConfirmRow(null);
        }}
      >
        <DialogContent
          className="max-w-md"
          data-testid="dialog-history-confirm-undo"
        >
          <DialogHeader>
            <DialogTitle>
              {t("reports.qbMapping.bulkActionsHistory.confirmUndoTitle")}
            </DialogTitle>
            <DialogDescription>
              {confirmRow
                ? t(
                    "reports.qbMapping.bulkActionsHistory.confirmUndoDescription",
                    {
                      summary: confirmRow.summary,
                      actor: actorDisplay(confirmRow),
                      when: new Date(confirmRow.createdAt).toLocaleString(),
                    },
                  )
                : ""}
            </DialogDescription>
          </DialogHeader>
          {confirmRow && (
            <div
              className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 flex items-start gap-2"
              data-testid="text-confirm-overlap"
            >
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>
                {t(
                  "reports.qbMapping.bulkActionsHistory.confirmUndoOverlap",
                  {
                    count: confirmRow.overlappingActionIds.length,
                    ids: confirmRow.overlappingActionIds
                      .map((id) => `#${id}`)
                      .join(", "),
                  },
                )}
              </span>
            </div>
          )}
          <DialogFooter>
            <PillButton
              color="red"
              onClick={() => setConfirmRow(null)}
              disabled={undoing}
              data-testid="button-confirm-cancel"
            >
              {t("reports.qbMapping.bulkActionsHistory.cancel")}
            </PillButton>
            <PillButton
              color="blue"
              disabled={undoing}
              onClick={() => confirmRow && performUndo(confirmRow)}
              data-testid="button-confirm-undo"
            >
              <Undo2 className="h-4 w-4 mr-1" />
              {undoing
                ? t("reports.qbMapping.undoing")
                : t("reports.qbMapping.bulkActionsHistory.confirmUndo")}
            </PillButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <BulkActionDetailsDialog
        row={detailRow}
        onClose={() => setDetailRow(null)}
      />
    </>
  );

}

// ── Bulk-action details dialog ────────────────────────────────────

export interface BulkActionDetailsDialogProps {
  row: QbBulkActionRow | null;
  onClose: () => void;
}

/** Build the `?offset=&limit=&q=&lineType=&vendorId=&partnerId=`
 * querystring shared by both the JSON fetch and the CSV-download link
 * so the two stay in lockstep. "all" sentinels are stripped (server
 * default), and the integer ids the Select component carried as
 * strings are passed through verbatim — the server already knows how
 * to parse them and the literal "_all" sentinel for null-scope rows. */
function buildDetailQuery(opts: {
  offset?: number;
  limit?: number;
  q: string;
  lineType: string;
  vendorId: string;
  partnerId: string;
}): URLSearchParams {
  const p = new URLSearchParams();
  if (opts.offset != null) p.set("offset", String(opts.offset));
  if (opts.limit != null) p.set("limit", String(opts.limit));
  if (opts.q.trim()) p.set("q", opts.q.trim());
  if (opts.lineType !== "all") p.set("lineType", opts.lineType);
  if (opts.vendorId !== "all") p.set("vendorId", opts.vendorId);
  if (opts.partnerId !== "all") p.set("partnerId", opts.partnerId);
  return p;
}

/** Sub-dialog opened from BulkActionsHistoryDialog. Loads the full
 * per-cell snapshot for one bulk action and renders every touched
 * (vendor, partner, line type) cell with its previous → applied
 * values. Snapshots are paginated server-side (default 200 cells per
 * page, capped at 500) so a 5,000-cell CSV import stays responsive. */
export function BulkActionDetailsDialog({
  row,
  onClose,
}: BulkActionDetailsDialogProps): ReactElement {
  const { t } = useTranslation();
  const PAGE_SIZE = 200;
  const [detail, setDetail] = useState<QbBulkActionDetail | null>(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Search input value bound to the field; `appliedQuery` is the
  // debounced/applied value sent to the server. Splitting them keeps
  // typing snappy and avoids firing a request on every keystroke.
  const [searchInput, setSearchInput] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  // Audit trail of "Download CSV" clicks for this bulk action so an
  // admin can see which user(s) walked off with a copy of the
  // snapshot without leaving the dialog.
  const [downloads, setDownloads] = useState<QbBulkActionDownload[] | null>(
    null,
  );
  // Exact-match scope filters. "all" = no filter; "_all" = match the
  // "all vendors" / "all partners" sentinel snapshot rows. Vendor and
  // partner ids are stringified so the Select component (which only
  // emits strings) can carry them; we coerce back to integers when
  // building the request URL. Mirrors the server-side filter contract.
  const [lineTypeFilter, setLineTypeFilter] = useState<string>("all");
  const [vendorFilter, setVendorFilter] = useState<string>("all");
  const [partnerFilter, setPartnerFilter] = useState<string>("all");
  // Vendor / partner option lists, loaded once when the dialog opens.
  // We narrow the dropdowns to just the entities this action actually
  // touched (using row.affectedVendorIds / row.affectedPartnerIds) so
  // an admin auditing one CSV import doesn't scroll past every vendor
  // in the system.
  const [allVendors, setAllVendors] = useState<VendorOption[]>([]);
  const [allPartners, setAllPartners] = useState<PartnerOption[]>([]);
  const open = row != null;
  const rowId = row?.id ?? null;

  // Reset page + filters whenever a new action is opened so we always
  // start on page 1 with a clean filter.
  useEffect(() => {
    if (open) {
      setPage(0);
      setSearchInput("");
      setAppliedQuery("");
      setDownloads(null);
      setLineTypeFilter("all");
      setVendorFilter("all");
      setPartnerFilter("all");
    }
  }, [open, rowId]);

  // Fetch the per-bulk-action download audit log once when the dialog
  // opens. Failures are intentionally non-fatal — if the audit
  // endpoint hiccups we just hide the indicator rather than blocking
  // the snapshot view.
  const refreshDownloads = useCallback(() => {
    if (rowId == null) return;
    let active = true;
    fetch(
      `${API_BASE}/api/reports/qb-account-mapping/bulk-actions/${rowId}/downloads`,
      { credentials: "include" },
    )
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as QbBulkActionDownloadsResponse;
      })
      .then((d) => {
        if (active) setDownloads(d.downloads);
      })
      .catch(() => {
        if (active) setDownloads(null);
      });
    return () => {
      active = false;
    };
  }, [rowId]);

  useEffect(() => {
    if (rowId == null) return;
    return refreshDownloads();
  }, [rowId, refreshDownloads]);

  // Load vendor + partner options once the dialog is opened. Failures
  // are swallowed because the dropdowns are an audit convenience —
  // the search input still works without them.
  useEffect(() => {
    if (!open) return;
    let active = true;
    fetch(`${API_BASE}/api/vendors`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((j: VendorOption[]) => {
        if (active) setAllVendors(Array.isArray(j) ? j : []);
      })
      .catch(() => {});
    fetch(`${API_BASE}/api/partners`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((j: PartnerOption[]) => {
        if (active) setAllPartners(Array.isArray(j) ? j : []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [open]);

  // Narrow the dropdowns to only vendors / partners this action
  // touched. The row already advertises them via `affectedVendorIds`
  // / `affectedPartnerIds`, so we don't need an extra round-trip.
  const affectedVendorIds = useMemo(
    () => new Set(row?.affectedVendorIds ?? []),
    [row?.affectedVendorIds],
  );
  const affectedPartnerIds = useMemo(
    () => new Set(row?.affectedPartnerIds ?? []),
    [row?.affectedPartnerIds],
  );
  const vendorOptions = useMemo(
    () =>
      allVendors
        .filter((v) => affectedVendorIds.has(v.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [allVendors, affectedVendorIds],
  );
  const partnerOptions = useMemo(
    () =>
      allPartners
        .filter((p) => affectedPartnerIds.has(p.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [allPartners, affectedPartnerIds],
  );

  // Debounce the search input → applied query so we don't pound the
  // server on every keystroke. 250ms feels responsive without
  // burning a request per character. Resets the page back to 1
  // whenever the applied query changes so the new first page of
  // matches is what the user sees.
  useEffect(() => {
    if (searchInput === appliedQuery) return;
    const handle = setTimeout(() => {
      setAppliedQuery(searchInput);
      setPage(0);
    }, 250);
    return () => clearTimeout(handle);
  }, [searchInput, appliedQuery]);

  // Fetch the requested slice every time the action, page, or search
  // changes.
  useEffect(() => {
    if (rowId == null) {
      setDetail(null);
      return;
    }
    let active = true;
    setLoading(true);
    setErr(null);
    const offset = page * PAGE_SIZE;
    const params = buildDetailQuery({
      offset,
      limit: PAGE_SIZE,
      q: appliedQuery,
      lineType: lineTypeFilter,
      vendorId: vendorFilter,
      partnerId: partnerFilter,
    });
    fetch(
      `${API_BASE}/api/reports/qb-account-mapping/bulk-actions/${rowId}?${params.toString()}`,
      { credentials: "include" },
    )
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as QbBulkActionDetail;
      })
      .then((d) => {
        if (active) setDetail(d);
      })
      .catch((e: Error) => {
        if (active) setErr(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [rowId, page, appliedQuery, lineTypeFilter, vendorFilter, partnerFilter]);

  // Reset to page 1 whenever a scope filter changes so paginators
  // don't strand the user on a now-empty page. (`appliedQuery` does
  // its own reset inside the debounce effect above.)
  useEffect(() => {
    setPage(0);
  }, [lineTypeFilter, vendorFilter, partnerFilter]);

  const isFiltered =
    appliedQuery.trim().length > 0 ||
    lineTypeFilter !== "all" ||
    vendorFilter !== "all" ||
    partnerFilter !== "all";

  const totalPages = detail
    ? Math.max(1, Math.ceil(detail.snapshotCount / PAGE_SIZE))
    : 1;
  const safePage = Math.min(page, totalPages - 1);
  const rangeStart = detail && detail.snapshotCount > 0
    ? safePage * PAGE_SIZE + 1
    : 0;
  const rangeEnd = detail
    ? Math.min(detail.snapshotCount, safePage * PAGE_SIZE + detail.cells.length)
    : 0;

  function HighlightedText({
    text,
    query,
  }: {
    text: string;
    query: string;
  }): ReactElement {
    const trimmed = query.trim();
    if (trimmed.length === 0) return <>{text}</>;
    const needle = trimmed.toLowerCase();
    const haystack = text.toLowerCase();
    const parts: ReactElement[] = [];
    let cursor = 0;
    let key = 0;
    while (cursor < text.length) {
      const idx = haystack.indexOf(needle, cursor);
      if (idx === -1) {
        parts.push(<Fragment key={key++}>{text.slice(cursor)}</Fragment>);
        break;
      }
      if (idx > cursor) {
        parts.push(
          <Fragment key={key++}>{text.slice(cursor, idx)}</Fragment>,
        );
      }
      parts.push(
        <mark
          key={key++}
          className="bg-yellow-200 text-foreground rounded-sm px-0.5"
          data-testid="mark-details-highlight"
        >
          {text.slice(idx, idx + needle.length)}
        </mark>,
      );
      cursor = idx + needle.length;
    }
    return <>{parts}</>;
  }

  function vendorLabel(c: QbBulkActionCell): string {
    if (c.vendorId == null)
      return t("reports.qbMapping.bulkActionsHistory.details.allVendors");
    return (
      c.vendorName ??
      t("reports.qbMapping.bulkActionsHistory.details.unknownVendor", {
        id: c.vendorId,
      })
    );
  }

  function partnerLabel(c: QbBulkActionCell): string {
    if (c.partnerId == null)
      return t("reports.qbMapping.bulkActionsHistory.details.allPartners");
    return (
      c.partnerName ??
      t("reports.qbMapping.bulkActionsHistory.details.unknownPartner", {
        id: c.partnerId,
      })
    );
  }

  function valueLabel(
    v: { accountName: string; accountNumber: string | null } | null,
  ): string {
    if (v == null)
      return t("reports.qbMapping.bulkActionsHistory.details.noPrevious");
    return v.accountNumber
      ? `${v.accountName} (${v.accountNumber})`
      : v.accountName;
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        className="max-w-5xl"
        data-testid="dialog-bulk-action-details"
      >
        <DialogHeader>
          <DialogTitle>
            {t("reports.qbMapping.bulkActionsHistory.details.title", {
              id: row?.id ?? 0,
            })}
          </DialogTitle>
          <DialogDescription>
            {row
              ? t("reports.qbMapping.bulkActionsHistory.details.description", {
                  summary: row.summary,
                  count: row.snapshotCount,
                })
              : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-end gap-2">
          {/*
            Server-side substring search across vendor, partner, line
            type, and previous/applied account name+number. Filtering
            runs over the FULL snapshot (not just the current page),
            so an admin can jump to a single suspicious row in a
            5,000-cell CSV import without paging through 25 pages.
          */}
          <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
            <Input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t(
                "reports.qbMapping.bulkActionsHistory.details.searchPlaceholder",
              )}
              aria-label={t(
                "reports.qbMapping.bulkActionsHistory.details.searchPlaceholder",
              )}
              disabled={rowId == null}
              data-testid="input-details-search"
            />
          </div>
          {/*
            Exact-match scope filters: line type, vendor, partner.
            Both the JSON fetch and the CSV download URL pick these up
            (see buildDetailQuery), so a focused download skips the
            "open in Excel and filter" step. Vendor / partner option
            lists are scoped to just the entities this action touched
            so the dropdowns stay short even on a 5,000-cell import.
          */}
          <div className="flex flex-col gap-1">
            <Label
              htmlFor="bulk-detail-line-type"
              className="text-xs"
            >
              {t(
                "reports.qbMapping.bulkActionsHistory.details.filter.lineType",
              )}
            </Label>
            <Select
              value={lineTypeFilter}
              onValueChange={setLineTypeFilter}
              disabled={rowId == null}
            >
              <SelectTrigger
                id="bulk-detail-line-type"
                className="w-44"
                data-testid="select-details-line-type"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  value="all"
                  data-testid="select-details-line-type-all"
                >
                  {t(
                    "reports.qbMapping.bulkActionsHistory.details.filter.allLineTypes",
                  )}
                </SelectItem>
                {ALLOWED_LINE_TYPES.map((lt) => (
                  <SelectItem
                    key={lt}
                    value={lt}
                    data-testid={`select-details-line-type-${lt}`}
                  >
                    {lt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="bulk-detail-vendor" className="text-xs">
              {t(
                "reports.qbMapping.bulkActionsHistory.details.filter.vendor",
              )}
            </Label>
            <Select
              value={vendorFilter}
              onValueChange={setVendorFilter}
              disabled={rowId == null}
            >
              <SelectTrigger
                id="bulk-detail-vendor"
                className="w-48"
                data-testid="select-details-vendor"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  value="all"
                  data-testid="select-details-vendor-all"
                >
                  {t(
                    "reports.qbMapping.bulkActionsHistory.details.filter.allVendors",
                  )}
                </SelectItem>
                {row?.affectedIncludesGlobalVendor && (
                  <SelectItem
                    value="_all"
                    data-testid="select-details-vendor-_all"
                  >
                    {t(
                      "reports.qbMapping.bulkActionsHistory.details.allVendors",
                    )}
                  </SelectItem>
                )}
                {vendorOptions.map((v) => (
                  <SelectItem
                    key={v.id}
                    value={String(v.id)}
                    data-testid={`select-details-vendor-${v.id}`}
                  >
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="bulk-detail-partner" className="text-xs">
              {t(
                "reports.qbMapping.bulkActionsHistory.details.filter.partner",
              )}
            </Label>
            <Select
              value={partnerFilter}
              onValueChange={setPartnerFilter}
              disabled={rowId == null}
            >
              <SelectTrigger
                id="bulk-detail-partner"
                className="w-48"
                data-testid="select-details-partner"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  value="all"
                  data-testid="select-details-partner-all"
                >
                  {t(
                    "reports.qbMapping.bulkActionsHistory.details.filter.allPartners",
                  )}
                </SelectItem>
                {row?.affectedIncludesGlobalPartner && (
                  <SelectItem
                    value="_all"
                    data-testid="select-details-partner-_all"
                  >
                    {t(
                      "reports.qbMapping.bulkActionsHistory.details.allPartners",
                    )}
                  </SelectItem>
                )}
                {partnerOptions.map((p) => (
                  <SelectItem
                    key={p.id}
                    value={String(p.id)}
                    data-testid={`select-details-partner-${p.id}`}
                  >
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {(lineTypeFilter !== "all" ||
            vendorFilter !== "all" ||
            partnerFilter !== "all") && (
            <PillButton
              color="image"
              onClick={() => {
                setLineTypeFilter("all");
                setVendorFilter("all");
                setPartnerFilter("all");
              }}
              data-testid="button-details-clear-filters"
            >
              {t(
                "reports.qbMapping.bulkActionsHistory.details.filter.clear",
              )}
            </PillButton>
          )}
        </div>
        {err && (
          <p
            className="text-sm text-destructive"
            data-testid="text-details-error"
          >
            {err}
          </p>
        )}
        {loading && !detail && (
          <p className="text-sm text-muted-foreground">
            {t("common.loading")}
          </p>
        )}
        {detail && detail.snapshotCount === 0 && (
          <p
            className="text-sm text-muted-foreground"
            data-testid="text-details-empty"
          >
            {isFiltered
              ? t(
                  "reports.qbMapping.bulkActionsHistory.details.noMatches",
                )
              : t("reports.qbMapping.bulkActionsHistory.details.empty")}
          </p>
        )}
        {detail && detail.cells.length > 0 && (
          <div className="overflow-x-auto max-h-[55vh]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    {t(
                      "reports.qbMapping.bulkActionsHistory.details.col.vendor",
                    )}
                  </TableHead>
                  <TableHead>
                    {t(
                      "reports.qbMapping.bulkActionsHistory.details.col.partner",
                    )}
                  </TableHead>
                  <TableHead>
                    {t(
                      "reports.qbMapping.bulkActionsHistory.details.col.lineType",
                    )}
                  </TableHead>
                  <TableHead>
                    {t(
                      "reports.qbMapping.bulkActionsHistory.details.col.previous",
                    )}
                  </TableHead>
                  <TableHead>
                    {t(
                      "reports.qbMapping.bulkActionsHistory.details.col.applied",
                    )}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.cells.map((c, idx) => {
                  const globalIdx = safePage * PAGE_SIZE + idx;
                  return (
                    <TableRow
                      key={`${globalIdx}-${c.vendorId ?? "_"}-${c.partnerId ?? "_"}-${c.lineType}`}
                      data-testid={`row-detail-${globalIdx}`}
                    >
                      <TableCell className="text-sm">
                        <HighlightedText
                          text={vendorLabel(c)}
                          query={appliedQuery}
                        />
                      </TableCell>
                      <TableCell className="text-sm">
                        <HighlightedText
                          text={partnerLabel(c)}
                          query={appliedQuery}
                        />
                      </TableCell>
                      <TableCell className="text-sm font-mono">
                        <HighlightedText
                          text={c.lineType}
                          query={appliedQuery}
                        />
                      </TableCell>
                      <TableCell
                        className={`text-sm ${
                          c.previous == null
                            ? "italic text-muted-foreground"
                            : ""
                        }`}
                        data-testid={`cell-previous-${globalIdx}`}
                      >
                        <HighlightedText
                          text={valueLabel(c.previous)}
                          query={appliedQuery}
                        />
                      </TableCell>
                      <TableCell
                        className="text-sm"
                        data-testid={`cell-applied-${globalIdx}`}
                      >
                        <HighlightedText
                          text={valueLabel(c.applied)}
                          query={appliedQuery}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between">
          <div className="flex items-center gap-3">
            <span
              className="text-xs text-muted-foreground"
              data-testid="text-details-range"
            >
              {detail
                ? t("reports.qbMapping.bulkActionsHistory.details.range", {
                    start: rangeStart,
                    end: rangeEnd,
                    total: detail.snapshotCount,
                  })
                : ""}
            </span>
            {/*
              "Downloaded N times" indicator. Backed by the per-bulk-action
              download audit endpoint (see reports.ts). Click expands a
              popover listing each downloader and timestamp so admins can
              trace "which accountant got a copy of this CSV import"
              during a compliance review.
            */}
            {downloads != null && (
              <Popover>
                <PopoverTrigger asChild>
                  <PillButton
                    type="button"
                    color="image"
                    className="h-7 px-2 text-xs text-muted-foreground"
                    disabled={downloads.length === 0}
                    data-testid="button-details-download-history"
                  >
                    <Download className="h-3.5 w-3.5 mr-1" />
                    {t(
                      "reports.qbMapping.bulkActionsHistory.details.downloadedNTimes",
                      { count: downloads.length },
                    )}
                  </PillButton>
                </PopoverTrigger>
                {downloads.length > 0 && (
                  <PopoverContent
                    className="w-80 max-h-72 overflow-y-auto"
                    align="start"
                    data-testid="popover-details-download-history"
                  >
                    <p className="text-xs font-medium mb-2">
                      {t(
                        "reports.qbMapping.bulkActionsHistory.details.downloadHistoryTitle",
                      )}
                    </p>
                    <ul className="space-y-2">
                      {downloads.map((d) => {
                        const who =
                          d.downloadedByDisplayName ??
                          d.downloadedByUsername ??
                          (d.downloadedByUserId != null
                            ? t(
                                "reports.qbMapping.bulkActionsHistory.details.downloadedByUserId",
                                { id: d.downloadedByUserId },
                              )
                            : t(
                                "reports.qbMapping.bulkActionsHistory.details.downloadedByUnknown",
                              ));
                        return (
                          <li
                            key={d.id}
                            className="text-xs"
                            data-testid={`row-download-${d.id}`}
                          >
                            <span
                              className="font-medium"
                              data-testid={`text-download-actor-${d.id}`}
                            >
                              {who}
                            </span>
                            <span className="text-muted-foreground">
                              {" · "}
                              {new Date(d.downloadedAt).toLocaleString()}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </PopoverContent>
                )}
              </Popover>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/*
              CSV download fetches the FULL snapshot (server bypasses the
              200/page slice when ?format=csv is set), so admins can audit
              a 5,000-cell import in one file. Disabled while the dialog
              is still loading the first page or when there's nothing to
              export yet.
            */}
            <a
              href={
                rowId != null
                  ? (() => {
                      const csvParams = buildDetailQuery({
                        q: appliedQuery,
                        lineType: lineTypeFilter,
                        vendorId: vendorFilter,
                        partnerId: partnerFilter,
                      });
                      csvParams.set("format", "csv");
                      return `${API_BASE}/api/reports/qb-account-mapping/bulk-actions/${rowId}?${csvParams.toString()}`;
                    })()
                  : undefined
              }
              download
              aria-disabled={
                rowId == null ||
                loading ||
                (detail?.snapshotCount ?? 0) === 0
              }
              onClick={(e) => {
                if (
                  rowId == null ||
                  loading ||
                  (detail?.snapshotCount ?? 0) === 0
                ) {
                  e.preventDefault();
                  return;
                }
                // Refresh the download audit list shortly after the
                // browser kicks off the CSV download so the indicator
                // reflects the new entry without forcing the admin to
                // close and reopen the dialog.
                setTimeout(() => refreshDownloads(), 1500);
              }}
              data-testid="link-details-download-csv"
            >
              <PillButton
                color="image"
                disabled={
                  rowId == null ||
                  loading ||
                  (detail?.snapshotCount ?? 0) === 0
                }
              >
                <FileSpreadsheet className="h-4 w-4 mr-1" />
                {t("reports.qbMapping.bulkActionsHistory.details.downloadCsv")}
              </PillButton>
            </a>
            <PillButton
              color="image"
              disabled={loading || safePage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              data-testid="button-details-prev"
            >
              {t("reports.qbMapping.bulkActionsHistory.prev")}
            </PillButton>
            <span className="text-xs text-muted-foreground">
              {t("reports.qbMapping.bulkActionsHistory.pageOf", {
                page: safePage + 1,
                total: totalPages,
              })}
            </span>
            <PillButton
              color="blue"
              disabled={loading || safePage >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              data-testid="button-details-next"
            >
              {t("reports.qbMapping.bulkActionsHistory.next")}
            </PillButton>
            {/*
              Detail dialog also keeps `page` 0-indexed internally; admins
              enter 1-indexed page numbers so we translate on submit. Form
              hides itself when there's only one page.
            */}
            <GoToPageForm
              totalPages={totalPages}
              disabled={loading}
              onGo={(target) => setPage(target - 1)}
              testIdPrefix="details"
            />
            <PillButton
              color="red"
              onClick={onClose}
              data-testid="button-details-close"
            >
              {t("reports.qbMapping.bulkActionsHistory.details.close")}
            </PillButton>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
