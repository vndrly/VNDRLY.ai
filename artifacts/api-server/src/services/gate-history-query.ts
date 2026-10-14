import { pool } from '@workspace/db';
import type { SessionPayload } from '../lib/session';
import { requireChangeOverAccess } from './gate-change-over';
import { databaseGateReportDependencies, GateReportsError, parseGateReportFilters, queryGateReport, type GateReportFilters, type GateReportKind, type GateReportRow } from './gate-reports';

type Input = { reportKind: GateReportKind; filters: GateReportFilters };
type Dependencies = {
 query: typeof queryGateReport;
 authorize: (session: SessionPayload, siteId: number) => Promise<unknown>;
 rows: typeof databaseGateReportDependencies.queryRows;
};
const defaults: Dependencies = {
 query: queryGateReport,
 authorize: (session, siteId) => requireChangeOverAccess(pool, session, siteId, { allowInactiveSite: true }),
 rows: databaseGateReportDependencies.queryRows,
};

/** A gatekeeper's on-screen history uses the same current site authority as Gate Ops.
 * This fallback never grants report delivery, downloads or other company access. */
export async function queryGateHistoryForSession(session: SessionPayload, input: Input, deps: Dependencies = defaults): Promise<GateReportRow[]> {
 try { return await deps.query({ userId: session.userId!, ...input }); }
 catch (error) {
  if (!(error instanceof GateReportsError) || error.status !== 403 || input.reportKind !== 'history') throw error;
  const filters = parseGateReportFilters(input.filters);
  try { await deps.authorize(session, filters.siteId); }
  catch { throw error; }
  return deps.rows(filters, { kind: 'full_site' }, 'history');
 }
}
