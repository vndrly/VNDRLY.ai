import { expect, it, vi } from 'vitest';
import { GateReportsError } from './gate-reports';
import { queryGateHistoryForSession } from './gate-history-query';
const session = { userId: 1, role: 'field_employee', vendorId: 2, sv: 1 };
const input = { reportKind: 'history' as const, filters: { siteId: 10, range: '30d' as const, recordType: 'all' as const } };
function dependencies() { return { query: vi.fn().mockRejectedValue(new GateReportsError(403, 'gate_report.forbidden')), authorize: vi.fn().mockResolvedValue({}), rows: vi.fn().mockResolvedValue([{id:'visit:1'}]) }; }
it('reads history only after current operational site authority passes', async () => {
 const deps=dependencies(); expect(await queryGateHistoryForSession(session,input,deps)).toEqual([{id:'visit:1'}]);
 expect(deps.authorize).toHaveBeenCalledWith(session,10); expect(deps.rows).toHaveBeenCalledWith(input.filters,{kind:'full_site'},'history',session);
});
it('denies an unassigned or revoked gatekeeper without reading records', async () => {
 const deps=dependencies(); deps.authorize.mockRejectedValue(new Error('revoked'));
 await expect(queryGateHistoryForSession(session,input,deps)).rejects.toMatchObject({status:403}); expect(deps.rows).not.toHaveBeenCalled();
});
it('preserves existing company redaction and never opens shift notes through this fallback', async () => {
 const deps=dependencies(); deps.query.mockResolvedValue([{id:'company:1'}]);
 expect(await queryGateHistoryForSession(session,input,deps)).toEqual([{id:'company:1'}]); expect(deps.authorize).not.toHaveBeenCalled();
 deps.query.mockRejectedValue(new GateReportsError(403,'gate_report.forbidden'));
 await expect(queryGateHistoryForSession(session,{...input,reportKind:'shift_notes'},deps)).rejects.toMatchObject({status:403}); expect(deps.rows).not.toHaveBeenCalled();
});
it('does not turn service failures into a permission workaround', async () => {
 const deps=dependencies(); deps.query.mockRejectedValue(new Error('database unavailable'));
 await expect(queryGateHistoryForSession(session,input,deps)).rejects.toThrow('database unavailable'); expect(deps.authorize).not.toHaveBeenCalled();
});
