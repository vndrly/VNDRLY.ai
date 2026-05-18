import { sql, type SQL } from "drizzle-orm";
import {
  ticketNoteLogsTable,
  hotlistCommentsTable,
  commentReadReceiptsTable,
} from "@workspace/db";

// ── Unread-comment count subqueries — Task #51 ──
//
// Both helpers return a Drizzle SQL fragment that evaluates to an integer
// suitable for embedding in a `select({...})` shape. They count comments
// on a single parent row (ticket / hotlist job) that the viewer has not
// yet seen, mirroring the read-receipt semantics enforced by
// `markAllSeen` in `routes/comments.ts`:
//
//   * Soft-deleted comments (deleted_at IS NOT NULL) are skipped — they
//     no longer render in the thread, so they shouldn't pad the badge.
//   * The viewer's own comments are skipped (created_by_id != viewer).
//     Authors don't get a badge for messages they just posted; opening
//     the thread will mark them as seen anyway.
//   * A comment is "unread" when no `comment_read_receipts` row exists
//     for (source, comment_id, viewer). The receipt is upserted on the
//     next thread fetch by `markAllSeen`, which is what clears the
//     badge after navigating into the detail page.
//
// `viewerUserId == null` short-circuits to literal `0` — used by guest /
// portal endpoints where there is no signed-in viewer.

export function unreadTicketCommentCountSql(
  ticketIdRef: SQL,
  viewerUserId: number | null,
): SQL<number> {
  if (viewerUserId == null) return sql<number>`0`;
  return sql<number>`(
    SELECT COUNT(*)::int FROM ${ticketNoteLogsTable}
    WHERE ${ticketNoteLogsTable.ticketId} = ${ticketIdRef}
      AND ${ticketNoteLogsTable.deletedAt} IS NULL
      AND ${ticketNoteLogsTable.createdById} IS DISTINCT FROM ${viewerUserId}
      AND NOT EXISTS (
        SELECT 1 FROM ${commentReadReceiptsTable}
        WHERE ${commentReadReceiptsTable.source} = 'ticket'
          AND ${commentReadReceiptsTable.commentId} = ${ticketNoteLogsTable.id}
          AND ${commentReadReceiptsTable.userId} = ${viewerUserId}
      )
  )`;
}

export function unreadHotlistCommentCountSql(
  jobIdRef: SQL,
  viewerUserId: number | null,
): SQL<number> {
  if (viewerUserId == null) return sql<number>`0`;
  return sql<number>`(
    SELECT COUNT(*)::int FROM ${hotlistCommentsTable}
    WHERE ${hotlistCommentsTable.jobId} = ${jobIdRef}
      AND ${hotlistCommentsTable.deletedAt} IS NULL
      AND ${hotlistCommentsTable.createdById} IS DISTINCT FROM ${viewerUserId}
      AND NOT EXISTS (
        SELECT 1 FROM ${commentReadReceiptsTable}
        WHERE ${commentReadReceiptsTable.source} = 'hotlist'
          AND ${commentReadReceiptsTable.commentId} = ${hotlistCommentsTable.id}
          AND ${commentReadReceiptsTable.userId} = ${viewerUserId}
      )
  )`;
}
