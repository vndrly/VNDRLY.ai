import { pool } from "@workspace/db";
import type { SessionPayload } from "../lib/session";
import { ChangeOverError, getShiftNotes } from "./gate-change-over";
import { queryGateHistoryForSession } from "./gate-history-query";
import { gateWindowCrossings, parseGateReportFilters } from "./gate-report-filters";
type Dependencies = {
  query: (sql: string, values: number[]) => Promise<{ rows: Record<string, any>[] }>;
  notes: (session: SessionPayload, input: { stationId: string; handoffId: string; limit: number }) => Promise<{ rows: Record<string, any>[] }>;
  history: typeof queryGateHistoryForSession;
};
const defaults: Dependencies = { query: (sql, values) => pool.query(sql, values), notes: getShiftNotes, history: queryGateHistoryForSession };
/** Own saved completion determines the target; the current page never does. */
export async function readMyLastGateShift(session: SessionPayload, deps: Dependencies = defaults) {
  if (!session.userId) throw new ChangeOverError(401, "auth.required", "Sign in required");
  const candidate = (await deps.query(`SELECT h.id AS handoff_id,s.station_id
    FROM gate_handovers h JOIN gate_preparations p ON p.id=h.preparation_id JOIN gate_shifts s ON s.id=p.shift_id
    WHERE s.operator_id=$1 AND s.ended_at IS NOT NULL AND h.acknowledged_at IS NOT NULL
    ORDER BY s.ended_at DESC,h.acknowledged_at DESC,h.id DESC LIMIT 1`, [session.userId])).rows[0];
  if (!candidate) return { found: false, reason: "No saved completed Gate handoff was found for this user. Current or 24-hour totals were not substituted." };
  // Reuse the existing history permission and projection before exposing its Gate.
  const note = (await deps.notes(session, { stationId: candidate.station_id, handoffId: candidate.handoff_id, limit: 1 })).rows[0];
  if (!note || note.outgoing_user_id !== session.userId) throw new ChangeOverError(403, "change_over.forbidden", "This completed shift is not visible in your current company context.");
  const from = new Date(note.started_at).toISOString(), to = new Date(note.ended_at).toISOString();
  const filters = parseGateReportFilters({ siteId: note.site_id, stationId: candidate.station_id, range: "custom", from, to, recordType: "all" });
  const rows = await deps.history(session, { reportKind: "history", filters });
  return { found: true, shift: { handoffId: candidate.handoff_id, siteId: filters.siteId, stationId: candidate.station_id, from, to }, crossings: gateWindowCrossings(rows, filters), recordCount: rows.length, truncated: rows.length >= 25000 };
}
