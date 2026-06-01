// Admin "Vendor merge history" page (Task #453).
//
// Surfaces every successful vendor merge from `vendor_merge_audit_log`
// so support can answer "who merged vendor X into vendor Y, when, and
// what moved?" without dropping into psql. Each row is the canonical
// shape returned by `GET /api/admin/vendor-merges`; the per-table
// counts and the loser snapshot are deliberately fetched on demand
// from `GET /api/admin/vendor-merges/:id` (those payloads can each be
// kilobytes — one per row blows up the list response after a few
// dozen merges).
//
// Layout:
//   • paged table of merges (newest first)
//   • clicking a row opens a dialog with the per-table count
//     breakdown plus the captured loser-vendor row (name, contacts,
//     addresses, tax IDs, logo URL, etc.)
//
// Admin-only — the route handlers also enforce this; the client guard
// is just to short-circuit the wasted fetch and show a clearer empty
// state when a non-admin lands here directly.

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListVendorMergeAuditLog,
  useGetVendorMergeAuditLog,
  useRevertVendorMerge,
  getListVendorMergeAuditLogQueryKey,
  getGetVendorMergeAuditLogQueryKey,
  type ListVendorMergeAuditLogParams,
  type VendorMergeAuditLogSummary,
  type VendorMergeAuditLogDetail,
  type RevertVendorMergeResponse,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PngPillButton as PillButton } from "@/components/png-pill-rollover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { GitMerge, RefreshCcw, Undo2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const PAGE_SIZE = 50;

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

// Render the captured loser snapshot as a label/value list. The
// snapshot is a verbatim jsonb copy of the loser `vendors` row at
// merge time — we don't pin a TypeScript shape on it because the
// vendors table can grow new columns and old audit rows must keep
// rendering. We surface known-useful fields first (name, contacts,
// tax IDs, addresses, logo) and drop the rest in a generic key/value
// table beneath them.
const KNOWN_SNAPSHOT_FIELDS: Array<{ key: string; label: string }> = [
  { key: "name", label: "Name" },
  { key: "contactName", label: "Contact name" },
  { key: "contactEmail", label: "Contact email" },
  { key: "contactPhone", label: "Contact phone" },
  { key: "businessPhone", label: "Business phone" },
  { key: "physicalAddress", label: "Physical address" },
  { key: "billingAddress", label: "Billing address" },
  { key: "stateTaxId", label: "State tax id" },
  { key: "federalTaxId", label: "Federal tax id" },
  { key: "logoUrl", label: "Logo URL" },
];

function renderScalar(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value || "—";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function LoserSnapshotPanel({
  snapshot,
}: {
  snapshot: VendorMergeAuditLogDetail["loserSnapshot"];
}) {
  // Partition the snapshot into "known fields" (rendered with friendly
  // labels in the order above) and "everything else" (rendered as a
  // generic key/value table so future schema additions are still
  // legible without a UI change).
  const knownKeys = new Set(KNOWN_SNAPSHOT_FIELDS.map((f) => f.key));
  const extras = Object.entries(snapshot).filter(([k]) => !knownKeys.has(k));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {KNOWN_SNAPSHOT_FIELDS.map(({ key, label }) => (
          <div key={key}>
            <div className="text-xs uppercase text-muted-foreground">
              {label}
            </div>
            <div
              className="text-sm break-words"
              data-testid={`text-loser-snapshot-${key}`}
            >
              {renderScalar(snapshot[key])}
            </div>
          </div>
        ))}
      </div>
      {extras.length > 0 && (
        <details className="border rounded p-2 text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            Other fields ({extras.length})
          </summary>
          <Table className="mt-2">
            <TableBody>
              {extras.map(([k, v]) => (
                <TableRow key={k}>
                  <TableCell className="font-mono align-top w-1/3">{k}</TableCell>
                  <TableCell className="font-mono break-all">
                    {renderScalar(v)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </details>
      )}
    </div>
  );
}

function CountsPanel({
  counts,
  totalMoved,
  totalConflictDeleted,
}: {
  counts: VendorMergeAuditLogDetail["counts"];
  totalMoved: number;
  totalConflictDeleted: number;
}) {
  // Sort tables alphabetically so the same merge always renders in
  // the same order across reloads. The audit row preserves whichever
  // order the merge lib returned, which can drift between releases.
  const rows = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No per-table activity was recorded.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Table</TableHead>
          <TableHead className="text-right">Moved</TableHead>
          <TableHead className="text-right">Conflict-deleted</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(([table, c]) => (
          <TableRow key={table} data-testid={`row-merge-count-${table}`}>
            <TableCell className="font-mono">{table}</TableCell>
            <TableCell
              className="text-right font-mono"
              data-testid={`cell-merge-count-move-${table}`}
            >
              {c.move}
            </TableCell>
            <TableCell
              className="text-right font-mono"
              data-testid={`cell-merge-count-conflict-${table}`}
            >
              {c.conflictDelete}
            </TableCell>
          </TableRow>
        ))}
        <TableRow className="font-medium">
          <TableCell>Totals</TableCell>
          <TableCell
            className="text-right font-mono"
            data-testid="cell-merge-totals-move"
          >
            {totalMoved}
          </TableCell>
          <TableCell
            className="text-right font-mono"
            data-testid="cell-merge-totals-conflict"
          >
            {totalConflictDeleted}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

// "What will / won't come back" panel rendered above the Revert
// button (and above the post-revert success banner). Built from the
// same per-table counts shown in CountsPanel — we just re-frame them
// from a "merge happened" perspective into a "if you revert, here's
// what you get back vs. what stays gone" perspective.
//
// Three sections, in order of permanence:
//   1. WILL come back — the loser vendor row itself (always one row).
//   2. WON'T come back automatically — rows moved to the survivor.
//      They still exist on the survivor; the revert just doesn't
//      re-point them at the restored loser.
//   3. CAN'T come back — rows conflict-deleted during the merge.
//      The merge dropped them to avoid violating a unique index and
//      we did NOT snapshot their contents, so they're permanently
//      lost regardless of whether the revert runs.
function RevertImpactPanel({
  counts,
  totalMoved,
  totalConflictDeleted,
}: {
  counts: VendorMergeAuditLogDetail["counts"];
  totalMoved: number;
  totalConflictDeleted: number;
}) {
  const movedTables = Object.entries(counts)
    .filter(([, c]) => c.move > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  const lostTables = Object.entries(counts)
    .filter(([, c]) => c.conflictDelete > 0)
    .sort(([a], [b]) => a.localeCompare(b));

  return (
    <div
      className="text-xs rounded border bg-muted/40 p-3 space-y-2"
      data-testid="panel-revert-impact"
    >
      <div className="font-medium text-sm">
        What this revert will and won't bring back
      </div>

      <div data-testid="panel-revert-will">
        <div className="font-medium text-green-700">Will come back</div>
        <ul className="list-disc list-inside ml-1">
          <li>
            The loser vendor row itself (recreated from the snapshot
            above, with the same numeric id).
          </li>
        </ul>
      </div>

      <div data-testid="panel-revert-stays">
        <div className="font-medium text-amber-700">
          Stays on the survivor ({totalMoved.toLocaleString()} row
          {totalMoved === 1 ? "" : "s"})
        </div>
        {movedTables.length === 0 ? (
          <div className="text-muted-foreground ml-1">
            No rows were moved during the original merge.
          </div>
        ) : (
          <ul className="list-disc list-inside ml-1">
            {movedTables.map(([table, c]) => (
              <li
                key={table}
                data-testid={`row-revert-stays-${table}`}
              >
                <span className="font-mono">{table}</span>
                {": "}
                {c.move.toLocaleString()}
              </li>
            ))}
          </ul>
        )}
        <div className="text-muted-foreground mt-1">
          These rows remain on the survivor and are not re-pointed at
          the restored vendor. Move them by hand if needed.
        </div>
      </div>

      <div data-testid="panel-revert-lost">
        <div className="font-medium text-destructive">
          Permanently lost (
          {totalConflictDeleted.toLocaleString()} row
          {totalConflictDeleted === 1 ? "" : "s"})
        </div>
        {lostTables.length === 0 ? (
          <div className="text-muted-foreground ml-1">
            No rows were conflict-deleted during the original merge.
          </div>
        ) : (
          <>
            <ul className="list-disc list-inside ml-1">
              {lostTables.map(([table, c]) => (
                <li
                  key={table}
                  data-testid={`row-revert-lost-${table}`}
                >
                  <span className="font-mono">{table}</span>
                  {": "}
                  {c.conflictDelete.toLocaleString()}
                </li>
              ))}
            </ul>
            <div className="text-muted-foreground mt-1">
              These rows were dropped during the merge to avoid a
              unique-index conflict and their contents were not
              captured in the audit log. The revert cannot restore
              them.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MergeDetailDialog({
  mergeId,
  onClose,
  onReverted,
}: {
  mergeId: number | null;
  onClose: () => void;
  onReverted: () => void;
}) {
  const open = mergeId !== null;
  // useGetVendorMergeAuditLog uses react-query so closing + reopening
  // a previously-viewed row hits the cache. We pass `enabled: open`
  // through the query options so the dialog doesn't refetch a stale
  // id while it's animating closed.
  const id = mergeId ?? 0;
  const { data, isLoading, isError, error, refetch } =
    useGetVendorMergeAuditLog(id, {
      query: {
        enabled: open,
        queryKey: getGetVendorMergeAuditLogQueryKey(id),
      },
    });
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // Local "we just reverted" banner. Cleared when the dialog closes
  // so reopening the same row (or a different row) starts fresh.
  const [restored, setRestored] = useState<RevertVendorMergeResponse | null>(
    null,
  );
  // Confirmation dialog state for the destructive Undo action
  // (Task #830). The button on the merge detail dialog opens an
  // AlertDialog so a stray click can't undo a merge.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const revert = useRevertVendorMerge({
    mutation: {
      onSuccess: (resp) => {
        setRestored(resp);
        setConfirmOpen(false);
        toast({
          title: "Vendor restored",
          description: `Recreated vendor #${resp.restoredVendorId} (${resp.restoredVendorName}).`,
        });
        // Invalidate the list + this row's detail so the next visit
        // sees the new conflict (the loser id is now occupied by the
        // restored vendor) and the row picks up the new `revertedAt`
        // timestamp / "Reverted" badge.
        // Generated list query keys start with the URL path, so use
        // a prefix predicate to catch every (limit, offset) variant.
        queryClient.invalidateQueries({
          predicate: (q) =>
            Array.isArray(q.queryKey) &&
            q.queryKey[0] === "/api/admin/vendor-merges",
        });
        queryClient.invalidateQueries({
          queryKey: getGetVendorMergeAuditLogQueryKey(id),
        });
        refetch();
      },
      onError: (err: unknown) => {
        setConfirmOpen(false);
        const body = (err as { response?: { data?: { error?: string } } })
          ?.response?.data;
        toast({
          title: "Could not revert merge",
          description:
            body?.error ??
            (err instanceof Error ? err.message : "Unknown error."),
          variant: "destructive",
        });
        // The most likely failure is "loser id was taken between the
        // detail fetch and the click", or the new "already reverted"
        // gate from Task #830 — refetch so the disabled state catches
        // up either way.
        refetch();
      },
    },
  });
  // The audit row carries `revertedAt` once it has been undone
  // (Task #830 idempotency gate). Hide the Undo affordance once that
  // is set, regardless of whether the loser id is currently free.
  const alreadyReverted = !!data?.revertedAt;

  const handleClose = () => {
    setRestored(null);
    setConfirmOpen(false);
    onClose();
    onReverted();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) handleClose();
      }}
    >
      <DialogContent
        className="max-w-3xl max-h-[85vh] overflow-y-auto"
        data-testid="dialog-vendor-merge-detail"
      >
        <DialogHeader>
          <DialogTitle>Vendor merge details</DialogTitle>
          <DialogDescription>
            Per-table counts and the snapshot of the deleted vendor as
            recorded at merge time.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="space-y-3">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        )}

        {isError && (
          <div
            className="text-sm text-destructive"
            data-testid="text-merge-detail-error"
          >
            Failed to load merge details:{" "}
            {error instanceof Error ? error.message : "unknown error"}
          </div>
        )}

        {data && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs uppercase text-muted-foreground">
                  Survivor
                </div>
                <div data-testid="text-merge-detail-survivor">
                  {data.survivorVendorId ? (
                    <Link
                      href={`/vendors/${data.survivorVendorId}`}
                      className="text-primary underline"
                    >
                      {data.survivorVendorName}
                    </Link>
                  ) : (
                    <span>{data.survivorVendorName}</span>
                  )}
                  <span className="text-muted-foreground ml-2">
                    #{data.survivorVendorId ?? "deleted"}
                  </span>
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">
                  Loser (deleted)
                </div>
                <div data-testid="text-merge-detail-loser">
                  {data.loserVendorName}
                  <span className="text-muted-foreground ml-2">
                    #{data.loserVendorId}
                  </span>
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">
                  When
                </div>
                <div>{formatDateTime(data.createdAt)}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">
                  Who
                </div>
                <div data-testid="text-merge-detail-actor">
                  {data.actorDisplayName ?? "(deleted user)"}
                  <Badge variant="secondary" className="ml-2">
                    {data.actorRole}
                  </Badge>
                </div>
              </div>
              {data.actorIp && (
                <div className="sm:col-span-2">
                  <div className="text-xs uppercase text-muted-foreground">
                    Request context
                  </div>
                  <div className="text-xs font-mono break-all">
                    {data.actorIp}
                    {data.actorUserAgent ? ` — ${data.actorUserAgent}` : ""}
                  </div>
                </div>
              )}
              {alreadyReverted && (
                <div className="sm:col-span-2">
                  <div className="text-xs uppercase text-muted-foreground">
                    Reverted
                  </div>
                  <div data-testid="text-merge-detail-reverted">
                    {formatDateTime(data.revertedAt as string)}
                    {data.revertedByDisplayName ? (
                      <span className="text-muted-foreground ml-2">
                        by {data.revertedByDisplayName}
                      </span>
                    ) : null}
                    <Badge variant="secondary" className="ml-2">
                      Loser vendor restored
                    </Badge>
                  </div>
                </div>
              )}
            </div>

            <div>
              <div className="text-sm font-medium mb-2">
                Per-table counts
              </div>
              <CountsPanel
                counts={data.counts}
                totalMoved={data.totalMoved}
                totalConflictDeleted={data.totalConflictDeleted}
              />
            </div>

            <div>
              <div className="text-sm font-medium mb-2">
                Loser snapshot
              </div>
              <LoserSnapshotPanel snapshot={data.loserSnapshot} />
            </div>

            {/*
              Undo merge action — combined surface from Tasks #822 and
              #830. The "Undo merge" button now opens an AlertDialog
              confirm before calling `useRevertVendorMerge` so a stray
              click can't undo a merge (Task #830 requirement). The
              control is hidden / replaced when:
                - the audit row's `revertedAt` is already set
                  (Task #830 idempotency gate — one Undo per merge),
                - we just succeeded in this dialog (`restored`), or
                - the original loser id has been taken by an unrelated
                  vendor (`!loserIdAvailable` from Task #822).
              FK rows that were re-pointed to the survivor stay where
              they are — that's a separate follow-up (Task #831).
            */}
            <div className="border-t pt-4 space-y-3">
              <div className="text-sm font-medium">Undo this merge</div>
              {/*
                #1238 / #1246 — Surface a clear "what will and what
                won't come back" panel so the admin understands the
                undo is partial *before* clicking. The audit log
                only captures per-table counts, not the row contents
                themselves, so:
                  • the loser vendor row itself comes back (from the
                    snapshot above)
                  • rows the merge MOVED onto the survivor are
                    re-pointed back to the restored loser when row-id
                    tracking exists; otherwise they stay on the
                    survivor and must be re-attached by hand
                  • rows the merge CONFLICT-DELETED are permanently
                    gone — the merge dropped them rather than UPDATE
                    them onto the survivor (would have violated a
                    unique index), and we never snapshotted their
                    contents, so nothing here can ever bring them
                    back. The list below names every table that lost
                    a row, with the count, so the admin knows what's
                    permanently un-restorable before committing to
                    the undo.
              */}
              <RevertImpactPanel
                counts={data.counts}
                totalMoved={data.totalMoved}
                totalConflictDeleted={data.totalConflictDeleted}
              />
              {restored ? (
                <div
                  className="text-sm rounded border border-green-300 bg-green-50 p-3 space-y-1"
                  data-testid="text-merge-reverted"
                >
                  <div>
                    Restored vendor #{restored.restoredVendorId} (
                    {restored.restoredVendorName}).
                  </div>
                  <div>
                    <Link
                      href={`/vendors/${restored.restoredVendorId}`}
                      className="text-primary underline"
                      data-testid="link-restored-vendor"
                    >
                      Open the restored vendor →
                    </Link>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Only the loser vendor row was recreated. Moved
                    rows ({data.totalMoved.toLocaleString()}) stay on
                    the survivor. Conflict-deleted rows
                    ({data.totalConflictDeleted.toLocaleString()})
                    were not snapshotted and remain permanently lost.
                  </div>
                </div>
              ) : alreadyReverted ? (
                <div
                  className="text-sm rounded border border-muted bg-muted/30 p-3 space-y-1"
                  data-testid="text-merge-detail-reverted"
                >
                  <div>
                    This merge was undone on{" "}
                    {formatDateTime(data.revertedAt as string)}
                    {data.revertedByDisplayName
                      ? ` by ${data.revertedByDisplayName}`
                      : ""}
                    .
                  </div>
                  <PillButton
                    color="image"
                    disabled
                    data-testid="button-merge-undo-disabled"
                  >
                    <Undo2 className="w-4 h-4 mr-1" />
                    Already undone
                  </PillButton>
                </div>
              ) : data.loserIdAvailable ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    Recreates the loser vendor row using the snapshot
                    above (same numeric id #{data.loserVendorId}).
                    Review the impact summary above before continuing.
                  </p>
                  <PillButton
                    color="red"
                    onClick={() => setConfirmOpen(true)}
                    disabled={revert.isPending}
                    data-testid="button-revert-vendor-merge"
                  >
                    <Undo2 className="w-4 h-4 mr-1" />
                    {revert.isPending ? "Undoing…" : "Undo merge"}
                  </PillButton>
                </>
              ) : (
                <div
                  className="text-sm rounded border border-amber-300 bg-amber-50 p-3"
                  data-testid="text-revert-blocked"
                >
                  Cannot revert: vendor id #{data.loserVendorId} is
                  already in use
                  {data.conflictingVendor ? (
                    <>
                      {" "}by{" "}
                      <Link
                        href={`/vendors/${data.conflictingVendor.id}`}
                        className="text-primary underline"
                        data-testid="link-conflicting-vendor"
                      >
                        {data.conflictingVendor.name}
                      </Link>
                      .
                    </>
                  ) : (
                    "."
                  )}
                </div>
              )}
            </div>

            <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
              <AlertDialogContent data-testid="dialog-merge-undo-confirm">
                <AlertDialogHeader>
                  <AlertDialogTitle>Undo this vendor merge?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will recreate &ldquo;{data.loserVendorName}&rdquo;
                    (vendor #{data.loserVendorId}) from the snapshot
                    captured at merge time. Records that were re-pointed
                    to the survivor stay on the survivor — you&apos;ll
                    need to re-attach them by hand. This action cannot
                    be undone twice.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="button-merge-undo-cancel">
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(e) => {
                      e.preventDefault();
                      revert.mutate({ id: data.id });
                    }}
                    disabled={revert.isPending}
                    data-testid="button-merge-undo-confirm"
                  >
                    {revert.isPending ? "Undoing…" : "Yes, undo merge"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MergeRow({
  row,
  onOpen,
}: {
  row: VendorMergeAuditLogSummary;
  onOpen: (id: number) => void;
}) {
  return (
    <TableRow
      className="cursor-pointer hover:bg-muted/40"
      onClick={() => onOpen(row.id)}
      data-testid={`row-vendor-merge-${row.id}`}
    >
      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
        {formatDateTime(row.createdAt)}
      </TableCell>
      <TableCell>
        <div className="font-medium" data-testid={`text-merge-survivor-${row.id}`}>
          {row.survivorVendorName}
        </div>
        <div className="text-xs text-muted-foreground">
          #{row.survivorVendorId ?? "deleted"}
        </div>
      </TableCell>
      <TableCell>
        <div className="font-medium" data-testid={`text-merge-loser-${row.id}`}>
          {row.loserVendorName}
        </div>
        <div className="text-xs text-muted-foreground">#{row.loserVendorId}</div>
      </TableCell>
      <TableCell data-testid={`text-merge-actor-${row.id}`}>
        {row.actorDisplayName ?? "(deleted user)"}
        <Badge variant="secondary" className="ml-2 text-xs">
          {row.actorRole}
        </Badge>
        {row.revertedAt && (
          <Badge
            variant="outline"
            className="ml-2 text-xs"
            data-testid={`badge-merge-reverted-${row.id}`}
          >
            Reverted
          </Badge>
        )}
      </TableCell>
      <TableCell
        className="text-right font-mono"
        data-testid={`text-merge-total-moved-${row.id}`}
      >
        {row.totalMoved}
      </TableCell>
      <TableCell
        className="text-right font-mono"
        data-testid={`text-merge-total-conflict-${row.id}`}
      >
        {row.totalConflictDeleted}
      </TableCell>
    </TableRow>
  );
}

export default function AdminVendorMerges() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<number | null>(null);

  // Filter form state. We keep the live form values in `*Input` and
  // only push them into the params (which drives the query) when the
  // operator clicks "Apply" (or the q field debounce fires). That
  // keeps each keystroke from firing a fresh /admin/vendor-merges
  // request.
  const [qInput, setQInput] = useState("");
  const [actorInput, setActorInput] = useState("");
  const [fromInput, setFromInput] = useState("");
  const [toInput, setToInput] = useState("");

  const [appliedQ, setAppliedQ] = useState("");
  const [appliedActor, setAppliedActor] = useState("");
  const [appliedFrom, setAppliedFrom] = useState("");
  const [appliedTo, setAppliedTo] = useState("");

  // Debounce the free-text vendor name search so typing doesn't
  // hammer the API. The actor / date inputs only apply on Submit
  // since they're more deliberate selections.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setAppliedQ(qInput.trim());
      setPage(0);
    }, 300);
    return () => window.clearTimeout(t);
  }, [qInput]);

  const offset = page * PAGE_SIZE;

  // <input type="datetime-local"> emits values like
  // `2026-05-11T13:30` with no timezone, which `new Date(...)`
  // interprets as local time — exactly what the operator typed,
  // but the API expects an ISO 8601 string with an offset. Convert
  // here so the server can parse it unambiguously.
  const toIsoOrUndefined = (v: string): string | undefined => {
    if (!v) return undefined;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return undefined;
    return d.toISOString();
  };

  const listParams: ListVendorMergeAuditLogParams = {
    limit: PAGE_SIZE,
    offset,
    ...(appliedQ ? { q: appliedQ } : {}),
    ...(appliedActor && Number.isInteger(Number(appliedActor)) && Number(appliedActor) > 0
      ? { actorUserId: Number(appliedActor) }
      : {}),
    ...(toIsoOrUndefined(appliedFrom)
      ? { createdFrom: toIsoOrUndefined(appliedFrom) }
      : {}),
    ...(toIsoOrUndefined(appliedTo)
      ? { createdTo: toIsoOrUndefined(appliedTo) }
      : {}),
  };
  const { data, isLoading, isError, error, refetch, isFetching } =
    useListVendorMergeAuditLog(listParams, {
      query: {
        enabled: isAdmin,
        queryKey: getListVendorMergeAuditLogQueryKey(listParams),
      },
    });

  const onApplyFilters = (e: React.FormEvent) => {
    e.preventDefault();
    setAppliedQ(qInput.trim());
    setAppliedActor(actorInput.trim());
    setAppliedFrom(fromInput);
    setAppliedTo(toInput);
    setPage(0);
  };

  const onClearFilters = () => {
    setQInput("");
    setActorInput("");
    setFromInput("");
    setToInput("");
    setAppliedQ("");
    setAppliedActor("");
    setAppliedFrom("");
    setAppliedTo("");
    setPage(0);
  };

  const hasActiveFilters =
    appliedQ !== "" ||
    appliedActor !== "" ||
    appliedFrom !== "" ||
    appliedTo !== "";

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageCount = useMemo(
    () => (total === 0 ? 1 : Math.ceil(total / PAGE_SIZE)),
    [total],
  );

  if (!isAdmin) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Admin role required.
      </div>
    );
  }

  const showingFrom = total === 0 ? 0 : offset + 1;
  const showingTo = Math.min(offset + items.length, total);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <GitMerge className="w-6 h-6 text-muted-foreground" />
          <div>
            <h1
              className="text-2xl font-semibold"
              data-testid="text-vendor-merges-title"
            >
              Vendor merge history
            </h1>
            <p className="text-sm text-muted-foreground">
              Every successful admin-initiated vendor merge, newest
              first. Click a row for the per-table breakdown and the
              snapshot of the deleted vendor.
            </p>
          </div>
        </div>
        <PillButton
          color="image"
          onClick={() => refetch()}
          disabled={isFetching}
          data-testid="button-refresh-vendor-merges"
        >
          <RefreshCcw
            className={`w-4 h-4 mr-1 ${isFetching ? "animate-spin" : ""}`}
          />
          Refresh
        </PillButton>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {total} merge{total === 1 ? "" : "s"}
            {hasActiveFilters ? " match the current filters" : " on record"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={onApplyFilters}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-4"
            data-testid="form-vendor-merges-filters"
          >
            <div className="lg:col-span-2">
              <Label htmlFor="filter-vendor-merges-q">Vendor name</Label>
              <Input
                id="filter-vendor-merges-q"
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                placeholder="Search survivor or loser…"
                data-testid="input-vendor-merges-q"
              />
            </div>
            <div>
              <Label htmlFor="filter-vendor-merges-actor">Admin user id</Label>
              <Input
                id="filter-vendor-merges-actor"
                type="number"
                inputMode="numeric"
                min={1}
                value={actorInput}
                onChange={(e) => setActorInput(e.target.value)}
                placeholder="e.g. 42"
                data-testid="input-vendor-merges-actor"
              />
            </div>
            <div>
              <Label htmlFor="filter-vendor-merges-from">From</Label>
              <Input
                id="filter-vendor-merges-from"
                type="datetime-local"
                value={fromInput}
                onChange={(e) => setFromInput(e.target.value)}
                data-testid="input-vendor-merges-from"
              />
            </div>
            <div>
              <Label htmlFor="filter-vendor-merges-to">To</Label>
              <Input
                id="filter-vendor-merges-to"
                type="datetime-local"
                value={toInput}
                onChange={(e) => setToInput(e.target.value)}
                data-testid="input-vendor-merges-to"
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-5 flex items-center gap-2">
              <PillButton
                type="submit"
                color="blue"
                data-testid="button-vendor-merges-apply-filters"
              >
                Apply filters
              </PillButton>
              <PillButton
                type="button"
                color="image"
                onClick={onClearFilters}
                disabled={
                  !hasActiveFilters &&
                  qInput === "" &&
                  actorInput === "" &&
                  fromInput === "" &&
                  toInput === ""
                }
                data-testid="button-vendor-merges-clear-filters"
              >
                Clear
              </PillButton>
            </div>
          </form>
          {isLoading && (
            <div className="space-y-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          )}

          {isError && (
            <div
              className="text-sm text-destructive"
              data-testid="text-vendor-merges-error"
            >
              Failed to load vendor merge history:{" "}
              {error instanceof Error ? error.message : "unknown error"}
            </div>
          )}

          {!isLoading && !isError && items.length === 0 && (
            <div
              className="text-sm text-muted-foreground"
              data-testid="text-vendor-merges-empty"
            >
              {hasActiveFilters
                ? "No vendor merges match the current filters."
                : "No vendor merges have been recorded yet."}
            </div>
          )}

          {!isLoading && !isError && items.length > 0 && (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Survivor</TableHead>
                    <TableHead>Loser (deleted)</TableHead>
                    <TableHead>Initiated by</TableHead>
                    <TableHead className="text-right">Moved</TableHead>
                    <TableHead className="text-right">Conflict-deleted</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody data-testid="list-vendor-merges">
                  {items.map((row) => (
                    <MergeRow key={row.id} row={row} onOpen={setOpenId} />
                  ))}
                </TableBody>
              </Table>

              <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
                <div data-testid="text-vendor-merges-page-summary">
                  Showing {showingFrom}–{showingTo} of {total}
                </div>
                <div className="flex items-center gap-2">
                  <PillButton
                    color="image"
                    disabled={page === 0 || isFetching}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    data-testid="button-vendor-merges-prev"
                  >
                    Previous
                  </PillButton>
                  <span data-testid="text-vendor-merges-page-indicator">
                    Page {page + 1} of {pageCount}
                  </span>
                  <PillButton
                    color="image"
                    disabled={page + 1 >= pageCount || isFetching}
                    onClick={() => setPage((p) => p + 1)}
                    data-testid="button-vendor-merges-next"
                  >
                    Next
                  </PillButton>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <MergeDetailDialog
        mergeId={openId}
        onClose={() => setOpenId(null)}
        onReverted={() => refetch()}
      />
    </div>
  );
}
