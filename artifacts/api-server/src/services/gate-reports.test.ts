import { describe, expect, it } from "vitest";
import {
  createMemoryGateReportDependencies,
  deliverGateReports,
  emailGateReportAttachments,
  listGateReportRecipients,
  openGateReport,
  parseGateReportFilters,
} from "./gate-reports";

const filters = {
  siteId: 10,
  range: "7d" as const,
  recordType: "all" as const,
  search: "ABC123",
};

describe("Gate reports", () => {
  it("supports the approved ranges through a full year", () => {
    expect(parseGateReportFilters({ ...filters, range: "1y" })).toMatchObject({ range: "1y" });
    expect(() => parseGateReportFilters({ ...filters, range: "10y" })).toThrow();
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
});
