// Adaptive byte formatter for the snapshot-size estimate that the
// QuickBooks bulk-action cleanup dialog and its parent banner share.
// Snapshot blobs are typically a few KB each and can stack into MB
// after a year of CSV imports; bumping the unit at each 1024-step
// keeps the displayed value in a comfortable single/double-digit
// range without needing a separate translation per unit. Uses
// 1 KB = 1024 B (binary) to match what `pg_column_size` reports —
// admins comparing the displayed value against `du -sh`/
// `pg_total_relation_size` will see consistent units.
//
// Lives in its own module (rather than as a private helper in
// reports.tsx) so component tests can mount the cleanup dialog and
// assert formatting independently, and so the byte→KB→MB→GB
// transitions can be exercised directly without rendering React.
export function formatSnapshotBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(gb >= 10 ? 1 : 2)} GB`;
}
