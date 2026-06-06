export type OpenJobRow = {
  id: number;
  status: string;
  siteName: string | null;
  partnerName: string | null;
  workTypeName: string | null;
  fieldEmployeeFirstName: string | null;
  fieldEmployeeLastName: string | null;
  createdAt: string;
  updatedAt: string | null;
  unreadCommentCount: number;
};

export type ClosedJobRow = {
  id: number;
  status: string;
  siteName: string | null;
  partnerName: string | null;
  workTypeName: string | null;
  checkOutTime: string | null;
  createdAt: string;
  updatedAt: string | null;
};

export type JobHistoryRow = {
  id: number;
  status: string;
  siteName: string | null;
  partnerName: string | null;
  workTypeName: string | null;
  fieldEmployeeFirstName: string | null;
  fieldEmployeeLastName: string | null;
  createdAt: string;
  updatedAt: string | null;
  unreadCommentCount: number;
  checkOutTime: string | null;
  isClosed: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function closedJobWithinDays(
  row: Pick<ClosedJobRow, "checkOutTime" | "updatedAt" | "createdAt">,
  days: number,
  nowMs = Date.now(),
): boolean {
  const anchor = row.checkOutTime ?? row.updatedAt ?? row.createdAt;
  const at = new Date(anchor).getTime();
  if (!Number.isFinite(at)) return false;
  return nowMs - at <= days * DAY_MS;
}

function sortKey(row: JobHistoryRow): number {
  const anchor = row.isClosed
    ? row.checkOutTime ?? row.updatedAt ?? row.createdAt
    : row.updatedAt ?? row.createdAt;
  const at = new Date(anchor).getTime();
  return Number.isFinite(at) ? at : 0;
}

/** Open jobs first, then closed jobs from the last `recentDays` days. */
export function mergeOpenAndRecentClosedJobs(
  open: OpenJobRow[],
  closed: ClosedJobRow[],
  recentDays = 30,
  nowMs = Date.now(),
): JobHistoryRow[] {
  const openIds = new Set(open.map((row) => row.id));
  const openRows: JobHistoryRow[] = open.map((row) => ({
    ...row,
    checkOutTime: null,
    isClosed: false,
  }));
  const closedRows: JobHistoryRow[] = closed
    .filter(
      (row) =>
        !openIds.has(row.id) &&
        closedJobWithinDays(row, recentDays, nowMs),
    )
    .map((row) => ({
      id: row.id,
      status: row.status,
      siteName: row.siteName,
      partnerName: row.partnerName,
      workTypeName: row.workTypeName,
      fieldEmployeeFirstName: null,
      fieldEmployeeLastName: null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      unreadCommentCount: 0,
      checkOutTime: row.checkOutTime,
      isClosed: true,
    }));

  openRows.sort((a, b) => sortKey(b) - sortKey(a));
  closedRows.sort((a, b) => sortKey(b) - sortKey(a));
  return [...openRows, ...closedRows];
}
