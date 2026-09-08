import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
const mock = vi.hoisted(() => ({ execute: vi.fn(), member: true, ids: null as string[] | null, latest: [] as { id: string }[], accessQueries: [] as string[], accessParams: [] as unknown[][] }));
vi.mock("@workspace/db", () => ({ db: { execute: async (query: any) => {
  const text = new PgDialect().sqlToQuery(query).sql;
  if (text.includes("gate_report_session_access")) return { rows: [{ gate_report_session_access: mock.member }] };
  if (text.includes("gate_report_snapshot_access")) { mock.accessQueries.push(text); mock.accessParams.push(new PgDialect().sqlToQuery(query).params); return { rows: (mock.ids ?? mock.latest.map(row => row.id)).map(id => ({ id })) }; }
  const result = await mock.execute(query); mock.latest = result.rows; return result;
} } }));
import { __resetGateReportSnapshotsForTests, buildGateReportQuery, gateReportOwner, getGateReport, parseGateReportFilters, prepareGateRows, summarizeGateRows } from "./gate-report";

const now = new Date("2026-09-07T18:00:00Z");
const admin = { userId: 1, role: "admin" };
const partner = { userId: 2, role: "partner", partnerId: 9 };
const vendor = { userId: 3, role: "vendor", vendorId: 7 };
const entry = (id = "visit:1") => ({ id, kind: "visitor" as const, category: "unclassified" as const, name: "Recorded person", company: "Midcon", purpose: "Delivery", siteLocationId: 4, siteName: "Site 4", partnerId: 9, checkInTime: "2026-09-07T12:00:00Z", checkOutTime: null, admissionStatus: null, identityKey: "guest-session:10" });
beforeEach(() => { __resetGateReportSnapshotsForTests(); mock.execute.mockReset(); mock.execute.mockResolvedValue({ rows: [] }); mock.member = true; mock.ids = null; mock.latest = []; mock.accessQueries = []; mock.accessParams = []; });

describe("Gate Log report authorization and completeness", () => {
  it.each([{ userId: 1, role: "partner" }, { userId: 1, role: "vendor" }, { userId: 1, role: "field_employee", vendorId: 7 }, { role: "admin" }])("fails closed for unsupported or missing org scope %j", session => {
    expect(() => gateReportOwner(session)).toThrow("active office company");
  });
  it("scopes vendor visitors to their host company and check-ins to their own workforce before combining", () => {
    const query = new PgDialect().sqlToQuery(buildGateReportQuery(vendor, parseGateReportFilters({}, now), now));
    expect(query.sql).toContain("v.host_type = 'vendor' AND v.host_vendor_id =");
    expect(query.sql).toContain("t.vendor_id =");
    expect(query.sql).toContain("AND p.vendor_id =");
    expect(query.params.filter(value => value === 7)).toHaveLength(3);
    expect(query.sql).toContain("p.vendor_id = t.vendor_id");
  });
  it("scopes partner records by site ownership in both sources and preserves requested filters", () => {
    const query = new PgDialect().sqlToQuery(buildGateReportQuery(partner, parseGateReportFilters({ siteLocationId: 55, partnerId: 66, recordKind: "visitor" }, now), now));
    expect(query.sql.match(/s\.partner_id =/g)).toHaveLength(2);
    expect(query.params.filter(value => value === 9)).toHaveLength(2);
    expect(query.params).toContain(55);
    expect(query.params).toContain(66);
    expect(query.params).toContain("visitor");
  });
  it("uses half-open overlap intervals for both sources, preserving visits that began before the range", () => {
    const query = new PgDialect().sqlToQuery(buildGateReportQuery(admin, parseGateReportFilters({ from: "2026-09-01T00:00:00Z", to: "2026-09-02T00:00:00Z" }, now), now));
    expect(query.sql).toMatch(/v\.check_in_time < \$/);
    expect(query.sql).toMatch(/v\.check_out_time IS NULL OR v\.check_out_time > \$/);
    expect(query.sql).toMatch(/c\.check_in_at < \$/);
    expect(query.sql).toMatch(/c\.check_out_at IS NULL OR c\.check_out_at > \$/);
    expect(query.sql).not.toContain("check_in_time >=");
  });
  it.each([{ from: "yesterday" }, { from: "2026-08-01T00:00:00Z", to: "2026-09-07T00:00:00Z" }, { from: "2026-09-07T00:00:00Z", to: "2026-09-06T00:00:00Z" }, { siteLocationId: -1 }, { recordKind: "internal_staff" }])("rejects ambiguous or excessive filters %j", filters => {
    expect(() => parseGateReportFilters(filters, now)).toThrow();
  });
  it("defaults to a bounded seven-day report", () => {
    const filters = parseGateReportFilters({}, now);
    expect(new Date(filters.to).getTime() - new Date(filters.from).getTime()).toBe(7 * 86_400_000);
  });
  it("distinguishes entries, identities, pending admission, on-site, and incomplete records", () => {
    const rows = prepareGateRows([entry(), { ...entry("visit:2"), admissionStatus: "pending" }, { ...entry("visit:3"), identityKey: null, purpose: null }, { ...entry("checkin:1"), kind: "employee_checkin", category: "routine_vendor_work", identityKey: "employee:10", checkOutTime: "2026-09-07T14:00:00Z" }], now);
    expect(summarizeGateRows(rows)).toEqual({ entries: 4, visitorEntries: 3, employeeCheckins: 1, currentOnsiteEntries: 2, uniqueRecordedIdentities: 2, unidentifiedEntries: 1, incompleteEntries: 3, unclassifiedEntries: 3, pendingAdmissionEntries: 1 });
  });
  it("returns complete totals beyond 2000 entries and stable pages from one snapshot", async () => {
    mock.execute.mockResolvedValue({ rows: Array.from({ length: 3001 }, (_, index) => entry(`visit:${index}`)) });
    const first = await getGateReport(admin, {}, now);
    expect(first.totals.entries).toBe(3001);
    expect(first.rows).toHaveLength(250);
    expect(first.nextOffset).toBe(250);
    mock.execute.mockResolvedValue({ rows: [] });
    const last = await getGateReport(admin, { snapshotId: first.snapshotId, offset: 3000 }, now);
    expect(last.rows[0].id).toBe("visit:3000");
    expect(last.totals.entries).toBe(3001);
    expect(last.nextOffset).toBeNull();
    expect(mock.execute).toHaveBeenCalledTimes(1);
  });
  it("binds cached snapshots to user and active company", async () => {
    const first = await getGateReport(partner, {}, now);
    await expect(getGateReport({ ...partner, partnerId: 10 }, { snapshotId: first.snapshotId }, now)).rejects.toMatchObject({ status: 410 });
    await expect(getGateReport({ ...partner, userId: 999 }, { snapshotId: first.snapshotId }, now)).rejects.toMatchObject({ status: 410 });
  });
  it("expires snapshots instead of silently rebuilding a later page against changed records", async () => {
    const first = await getGateReport(admin, {}, now);
    await expect(getGateReport(admin, { snapshotId: first.snapshotId }, new Date(now.getTime() + 11 * 60_000))).rejects.toMatchObject({ status: 410 });
  });
  it("rejects oversized exports explicitly rather than returning truncated rows or totals", async () => {
    mock.execute.mockResolvedValue({ rows: Array.from({ length: 25001 }, () => entry()) });
    await expect(getGateReport(admin, {}, now)).rejects.toMatchObject({ status: 413, code: "gate_report.too_large" });
  });
  it("does not guess historical visitor admin roles from free text", async () => {
    mock.execute.mockResolvedValue({ rows: [{ ...entry(), purpose: "Vendor admin" }] });
    const report = await getGateReport(vendor, {}, now);
    expect(report.rows[0].category).toBe("unclassified");
    expect(report.rows[0].purpose).toBe("Vendor admin");
    expect(report.coverage.vendorAdminClassification).toBe("explicit_staff_entry_only");
    expect(report.coverage.securityScreening).toBe("not_recorded");
  });
  it("rejects continuation after current company membership is revoked", async () => {
    const first = await getGateReport(vendor, {}, now);
    mock.member = false;
    await expect(getGateReport(vendor, { snapshotId: first.snapshotId }, now)).rejects.toMatchObject({ status: 403 });
  });
  it("invalidates all cached rows and totals when current host/workforce authorization changes", async () => {
    mock.execute.mockResolvedValue({ rows: [entry()] });
    const first = await getGateReport(vendor, {}, now);
    mock.ids = [];
    await expect(getGateReport(vendor, { snapshotId: first.snapshotId }, now)).rejects.toMatchObject({ status: 403, code: "gate_report.access_changed" });
    expect(mock.accessQueries[0]).toContain("v.host_vendor_id =");
    expect(mock.accessQueries[0]).toContain("p.vendor_id =");
    await expect(getGateReport(vendor, { snapshotId: first.snapshotId }, now)).rejects.toMatchObject({ status: 410 });
  });
  it("does not evict another user's snapshot when global capacity fills", async () => {
    const first = await getGateReport(admin, {}, now);
    for (let userId = 2; userId <= 32; userId++) await getGateReport({ ...admin, userId }, {}, now);
    await expect(getGateReport({ ...admin, userId: 33 }, {}, now)).rejects.toMatchObject({ status: 503, code: "gate_report.capacity" });
    expect((await getGateReport(admin, { snapshotId: first.snapshotId }, now)).snapshotId).toBe(first.snapshotId);
  });
  it("limits replacement to the owner's older snapshots", async () => {
    const other = await getGateReport(partner, {}, now);
    const first = await getGateReport(admin, {}, now);
    await getGateReport(admin, {}, now);
    await getGateReport(admin, {}, now);
    await expect(getGateReport(admin, { snapshotId: first.snapshotId }, now)).rejects.toMatchObject({ status: 410 });
    expect((await getGateReport(partner, { snapshotId: other.snapshotId }, now)).snapshotId).toBe(other.snapshotId);
  });
  it("binds snapshot IDs as single PostgreSQL array parameters, including the empty source", async () => {
    mock.execute.mockResolvedValue({ rows: [entry("visit:1"), entry("visit:2")] });
    const first = await getGateReport(vendor, {}, now);
    await getGateReport(vendor, { snapshotId: first.snapshotId }, now);
    expect(mock.accessParams[0]).toContainEqual([1, 2]);
    expect(mock.accessParams[0]).toContainEqual([]);
    expect(mock.accessQueries[0]).toMatch(/ANY\(\$\d+::int\[\]\)/);
    expect(mock.accessQueries[0]).not.toMatch(/\([^)]*,[^)]*\)::int\[\]/);
  });
  it("reads only structured stored categories and filters explicit administrator entries", () => {
    const query = new PgDialect().sqlToQuery(buildGateReportQuery(admin, parseGateReportFilters({ category: "partner_admin" }, now), now));
    expect(query.sql).toContain("v.entry_category IN");
    expect(query.sql).toContain("ELSE 'unclassified'");
    expect(query.params).toContain("partner_admin");
    expect(query.sql).not.toMatch(/CASE WHEN.*purpose/);
  });
});
