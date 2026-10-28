import { describe, expect, it, vi } from "vitest";
import { pool } from "@workspace/db";
import { readFileSync } from "node:fs";
import {
  createMemoryGateReportDependencies,
  deliverGateReports,
  emailGateReportAttachments,
  listGateReportRecipients,
  openGateReport,
  parseGateReportFilters,
  databaseGateReportDependencies,
} from "./gate-reports";

const filters = {
  siteId: 10,
  range: "7d" as const,
  recordType: "all" as const,
  search: "ABC123",
};

describe("Gate reports", () => {
  it("reads an exact old record within the authorized site and retains company redaction", async () => {
    const row = { id: "employee:42", name: "Sam", company: "Acme", checkInTime: "2025-01-01T12:00:00Z", checkOutTime: "2025-01-01T13:00:00Z" };
    const query = vi.spyOn(pool, "query").mockResolvedValue({ rows: [row] } as never);
    try {
      const filters = { siteId: 10, range: "current_shift" as const, recordType: "on_site" as const, recordId: "employee:42" };
      expect(await databaseGateReportDependencies.queryRows(filters, { kind: "company", company: "Acme" }, "history")).toEqual([row]);
      expect(query).toHaveBeenCalledWith(expect.stringContaining("t.site_location_id=$1"), [10, expect.any(Date), expect.any(Date), "employee:42"]);
      expect(await databaseGateReportDependencies.queryRows(filters, { kind: "company", company: "Other" }, "history")).toEqual([]);
      expect(query.mock.calls.every(([sql]) => String(sql).includes("$4::text IS NOT NULL"))).toBe(true);
    } finally { query.mockRestore(); }
    expect(() => parseGateReportFilters({ siteId: 10, range: "7d", recordType: "all", recordId: "visit:1 OR true" })).toThrow();
  });
  it("moves a corrected missed departure out of On Site without inventing a checkout time", async () => {
    const corrected = { id: "visit:88", name: "Taylor", checkOutTime: null, reconciliationState: "confirmed_off_site" };
    const present = { id: "visit:89", name: "Sam", checkOutTime: null, reconciliationState: null };
    const query = vi.spyOn(pool, "query").mockResolvedValue({ rows: [corrected, present] } as never);
    try {
      const base = { siteId: 10, range: "7d" as const };
      expect(await databaseGateReportDependencies.queryRows({ ...base, recordType: "on_site" }, { kind: "full_site" }, "history")).toEqual([present]);
      expect(await databaseGateReportDependencies.queryRows({ ...base, recordType: "check_outs" }, { kind: "full_site" }, "history")).toEqual([corrected]);
      expect(corrected.checkOutTime).toBeNull();
    } finally { query.mockRestore(); }
  });
  it("keeps waiting-to-enter records out of On Site and in pending arrivals", async () => {
    const pending = { id: "visit:1", admissionStatus: "pending", checkOutTime: null };
    const admitted = { id: "visit:2", admissionStatus: "admitted", checkOutTime: null };
    const departed = { id: "visit:3", admissionStatus: "pending", checkOutTime: "2026-10-28T12:00:00Z" };
    const query = vi.spyOn(pool, "query").mockResolvedValue({ rows: [pending, admitted, departed] } as never);
    try {
      const base = { siteId: 10, range: "7d" as const };
      expect(await databaseGateReportDependencies.queryRows({ ...base, recordType: "on_site" }, { kind: "full_site" }, "history")).toEqual([admitted]);
      expect(await databaseGateReportDependencies.queryRows({ ...base, recordType: "pending" }, { kind: "full_site" }, "history")).toEqual([pending]);
    } finally { query.mockRestore(); }
  });
  it("keeps peer gatekeepers eligible for shift handoff reports", () => {
    const source = readFileSync(new URL("./gate-reports.ts", import.meta.url), "utf8");
    const eligibleRoleClauses = source.match(
      /vp\.vendor_role IN \('office','both','gate_supervisor','gatekeeper'\)/g,
    );

    expect(eligibleRoleClauses).toHaveLength(2);
  });

  it("supports the approved ranges through a full year", () => {
    expect(parseGateReportFilters({ ...filters, range: "1y" })).toMatchObject({ range: "1y" });
    expect(() => parseGateReportFilters({ ...filters, range: "10y" })).toThrow();
  });
  it("accepts incoming-arrival and combined on-site report filters", () => {
    expect(parseGateReportFilters({ ...filters, recordType: "arrivals" }).recordType).toBe("arrivals");
    expect(parseGateReportFilters({ ...filters, recordType: "on_site" }).recordType).toBe("on_site");
  });
  it("does not export live arrivals without a current authenticated session", async () => {
    await expect(databaseGateReportDependencies.queryRows({ ...filters, recordType: "arrivals" }, {kind:"full_site"}, "history"))
      .rejects.toMatchObject({status:403,code:"gate_report.current_session_required"});
  });

  it("delivers secure links to multiple eligible user ids without accepting addresses", async () => {
    const deps = createMemoryGateReportDependencies({
      access: new Map([
        [1, { kind: "full_site" }],
        [2, { kind: "full_site" }],
        [3, { kind: "company", company: "NewTek" }],
      ]),
    });
    const result = await deliverGateReports({
      senderUserId: 1,
      recipientUserIds: [2, 3],
      reportKind: "history",
      format: "pdf",
      filters,
    }, deps);
    expect(result).toHaveLength(2);
    expect(deps.sent()).toHaveLength(2);
    expect(deps.sent().every((message) => message.url.includes("reportToken="))).toBe(true);
  });

  it("rechecks recipient access when a secure report link is opened", async () => {
    const access = new Map<number, { kind: "full_site" } | null>([
      [1, { kind: "full_site" }],
      [2, { kind: "full_site" }],
    ]);
    const deps = createMemoryGateReportDependencies({ access });
    await deliverGateReports({
      senderUserId: 1,
      recipientUserIds: [2],
      reportKind: "history",
      format: "word",
      filters,
    }, deps);
    const token = deps.sent()[0]!.token;
    access.set(2, null);
    await expect(openGateReport({ token, userId: 2 }, deps)).rejects.toMatchObject({ status: 403 });
  });

  it("limits subcontractor history to company rows and requires full scope for shift notes", async () => {
    const deps = createMemoryGateReportDependencies({
      access: new Map([
        [1, { kind: "full_site" }],
        [3, { kind: "company", company: "NewTek" }],
      ]),
      rows: [
        { id: "visit:1", company: "NewTek", name: "Alex", checkInTime: new Date().toISOString() },
        { id: "visit:2", company: "Other Co", name: "Sam", checkInTime: new Date().toISOString() },
      ],
    });
    await deliverGateReports({
      senderUserId: 1,
      recipientUserIds: [3],
      reportKind: "history",
      format: "excel",
      filters,
    }, deps);
    const report = await openGateReport({ token: deps.sent()[0]!.token, userId: 3 }, deps);
    expect(report.body.toString()).toContain("NewTek");
    expect(report.body.toString()).not.toContain("Other Co");
    await expect(deliverGateReports({
      senderUserId: 1,
      recipientUserIds: [3],
      reportKind: "shift_notes",
      format: "pdf",
      filters,
    }, deps)).rejects.toMatchObject({ status: 403 });
  });

  it("emails the selected report file with Search History and the time period in the subject", async () => {
    const deps = createMemoryGateReportDependencies({
      access: new Map([
        [1, { kind: "full_site" }],
        [2, { kind: "full_site" }],
      ]),
      rows: [{ id: "visit:1", name: "Alex", company: "MidCon" }],
    });

    await emailGateReportAttachments({
      senderUserId: 1,
      recipientUserIds: [2],
      reportKind: "history",
      format: "word",
      filters: { ...filters, range: "30d" },
    }, deps);

    expect(deps.attachments()).toEqual([
      expect.objectContaining({
        recipientUserId: 2,
        subject: "Search History — Last 30 Days",
        filename: "vndrly-gate-report.doc",
        contentType: "application/msword",
      }),
    ]);
    expect(deps.attachments()[0]!.body.toString()).toContain("Site:</strong> Big Cs Deep");
    expect(deps.attachments()[0]!.body.toString()).toContain("Gate:</strong> Main gate");
  });

  it("rejects shift-note delivery to a full-site account outside the authorized gate recipient list", async () => {
    const deps = createMemoryGateReportDependencies({
      access: new Map([
        [1, { kind: "full_site" }],
        [2, { kind: "full_site" }],
      ]),
      recipients: [{ userId: 1, name: "Gate Supervisor", role: "gate_supervisor" }],
    });
    await expect(deliverGateReports({ senderUserId: 1, recipientUserIds: [2], reportKind: "shift_notes", format: "pdf", filters }, deps)).rejects.toMatchObject({ status: 403 });
  });

  it("populates the selector from authorized user accounts", async () => {
    const deps = createMemoryGateReportDependencies({
      access: new Map([
        [1, { kind: "full_site" }],
        [2, { kind: "full_site" }],
        [3, null],
      ]),
    });
    const recipients = await listGateReportRecipients({
      senderUserId: 1,
      reportKind: "history",
      filters,
    }, deps);
    expect(recipients.map((recipient) => recipient.userId)).toEqual([1, 2]);
  });

  it("keeps gate report recipients inside the sender's company chain", async () => {
    const deps = createMemoryGateReportDependencies({
      access: new Map([
        [1, { kind: "full_site" }],
        [2, { kind: "full_site" }],
        [3, { kind: "full_site" }],
        [4, { kind: "full_site" }],
        [5, { kind: "full_site" }],
      ]),
      candidates: [
        { userId: 1, name: "Bob Gatekeeper", role: "gatekeeper", relationship: "self", accountKind: "standard", senderIsCompanyAdmin: false },
        { userId: 2, name: "Midcon Supervisor", role: "gate_supervisor", relationship: "company", accountKind: "standard", senderIsCompanyAdmin: false },
        { userId: 3, name: "E2E Test Admin", role: "admin", relationship: "company", accountKind: "test", senderIsCompanyAdmin: false },
        { userId: 4, name: "Warwick Admin", role: "admin", relationship: "unrelated", accountKind: "standard", senderIsCompanyAdmin: false },
        { userId: 5, name: "VNDRLY Admin", role: "admin", relationship: "platform", accountKind: "canonical_platform_admin", senderIsCompanyAdmin: false },
      ],
    });
    const recipients = await listGateReportRecipients({ senderUserId: 1, reportKind: "history", filters }, deps);
    expect(recipients.map((recipient) => recipient.userId)).toEqual([1, 2]);
  });

  it("offers the single canonical VNDRLY admin only to a company admin", async () => {
    const deps = createMemoryGateReportDependencies({
      access: new Map([
        [10, { kind: "full_site" }],
        [11, { kind: "full_site" }],
        [12, { kind: "full_site" }],
      ]),
      candidates: [
        { userId: 10, name: "Midcon Admin", role: "admin", relationship: "self", accountKind: "standard", senderIsCompanyAdmin: true },
        { userId: 11, name: "VNDRLY Admin", role: "admin", relationship: "platform", accountKind: "canonical_platform_admin", senderIsCompanyAdmin: true },
        { userId: 12, name: "VNDRLY Admin", role: "admin", relationship: "platform", accountKind: "platform_admin", senderIsCompanyAdmin: true },
      ],
    });
    const recipients = await listGateReportRecipients({ senderUserId: 10, reportKind: "history", filters }, deps);
    expect(recipients.map((recipient) => recipient.userId)).toEqual([10, 11]);
  });

  it("returns each authorized recipient only once when memberships overlap", async () => {
    const deps = createMemoryGateReportDependencies({
      access: new Map([
        [1, { kind: "full_site" }],
        [2, { kind: "full_site" }],
      ]),
      candidates: [
        { userId: 1, name: "Bob Gatekeeper", role: "gatekeeper", relationship: "self", accountKind: "standard", senderIsCompanyAdmin: false },
        { userId: 2, name: "Midcon Supervisor", role: "gate_supervisor", relationship: "company", accountKind: "standard", senderIsCompanyAdmin: false },
        { userId: 2, name: "Midcon Supervisor", role: "office", relationship: "company", accountKind: "standard", senderIsCompanyAdmin: false },
      ],
    });
    const recipients = await listGateReportRecipients({ senderUserId: 1, reportKind: "history", filters }, deps);
    expect(recipients.map((recipient) => recipient.userId)).toEqual([1, 2]);
  });

  it("rejects a direct delivery request to a recipient outside the selector policy", async () => {
    const deps = createMemoryGateReportDependencies({
      access: new Map([
        [1, { kind: "full_site" }],
        [4, { kind: "full_site" }],
      ]),
      candidates: [
        { userId: 1, name: "Bob Gatekeeper", role: "gatekeeper", relationship: "self", accountKind: "standard", senderIsCompanyAdmin: false },
        { userId: 4, name: "Unrelated Admin", role: "admin", relationship: "unrelated", accountKind: "standard", senderIsCompanyAdmin: false },
      ],
    });
    await expect(deliverGateReports({
      senderUserId: 1,
      recipientUserIds: [4],
      reportKind: "history",
      format: "pdf",
      filters,
    }, deps)).rejects.toMatchObject({ status: 403, code: "gate_report.recipient_forbidden" });
  });
});
