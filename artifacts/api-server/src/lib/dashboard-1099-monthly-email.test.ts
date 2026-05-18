// Stub-based unit tests for the scheduled 1099-K monthly breakout email
// worker (Task #806). We mock @workspace/db so the SQL pipeline is
// driven without touching Postgres; the real cross-instance dedupe race
// is exercised by the unique index on dashboard_1099_email_log.dedupe_key
// itself.
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const settingsRows: unknown[] = [];
const partnerRows: Array<{ id: number; name: string }> = [];
const insertedLogs: Record<string, unknown>[] = [];
const insertedAudits: Record<string, unknown>[] = [];
const updatedLogs: Array<{ id: number; set: Record<string, unknown> }> = [];
let logIdCounter = 1;
let auditIdCounter = 1;
let dedupeKeysSeen: Set<string> = new Set();
const sendMock = vi.fn();
const buildDashboardMock = vi.fn();

vi.mock("@workspace/db", () => {
  // Each `from(table)` chain returns the same fluent object whose
  // `.where(...).limit?(...)` etc. resolves to a canned result chosen
  // by table identity. We tag tables with a string to discriminate.
  const dashboardSettingsTable = { __tag: "settings" } as const;
  const dashboardLogTable = { __tag: "log" } as const;
  const partnersTable = { __tag: "partners" } as const;
  const reportExportTable = { __tag: "audit" } as const;

  function makeSelectChain(tableTag: string): Record<string, unknown> {
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.where = () => chain;
    chain.limit = () => chain;
    chain.then = (resolve: (rows: unknown[]) => unknown) => {
      if (tableTag === "settings") return resolve(settingsRows);
      if (tableTag === "partners") return resolve(partnerRows);
      return resolve([]);
    };
    return chain;
  }

  return {
    db: {
      select: () => ({
        from: (table: { __tag: string }) => makeSelectChain(table.__tag),
      }),
      insert: (table: { __tag: string }) => ({
        values: (vals: Record<string, unknown>) => {
          if (table.__tag === "log") {
            return {
              onConflictDoNothing: () => ({
                returning: async () => {
                  const dk = vals.dedupeKey as string;
                  if (dedupeKeysSeen.has(dk)) return [];
                  dedupeKeysSeen.add(dk);
                  const id = logIdCounter++;
                  insertedLogs.push({ id, ...vals });
                  return [{ id }];
                },
              }),
            };
          }
          if (table.__tag === "audit") {
            return {
              returning: async () => {
                const id = auditIdCounter++;
                insertedAudits.push({ id, ...vals });
                return [{ id }];
              },
            };
          }
          throw new Error(`unexpected insert table ${table.__tag}`);
        },
      }),
      update: (table: { __tag: string }) => ({
        set: (vals: Record<string, unknown>) => ({
          where: async (whereExpr: { __id: number }) => {
            updatedLogs.push({ id: whereExpr.__id, set: vals });
            void table;
          },
        }),
      }),
    },
    dashboard1099EmailSettingsTable: dashboardSettingsTable,
    dashboard1099EmailLogTable: { ...dashboardLogTable, dedupeKey: "dedupeKey", id: "id" },
    partnersTable: { ...partnersTable, id: "id", name: "name" },
    reportExportAuditLogTable: { ...reportExportTable, id: "id" },
  };
});
vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ __id: val, col }),
  inArray: () => ({ __op: "in" }),
}));
vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("./reports/dashboard1099-export", () => ({
  dashboard1099MonthlyKCsv: () => "form,recipient\nK,Acme\n",
  dashboard1099MonthlyKPdf: async () => Buffer.from("%PDF-stub"),
}));
vi.mock("./reports/dashboard1099", () => ({
  build1099Dashboard: (...args: unknown[]) => buildDashboardMock(...args),
}));
vi.mock("./sendgrid", () => ({
  sendDashboard1099MonthlyEmail: (...args: unknown[]) => sendMock(...args),
}));

beforeEach(() => {
  settingsRows.length = 0;
  partnerRows.length = 0;
  insertedLogs.length = 0;
  insertedAudits.length = 0;
  updatedLogs.length = 0;
  logIdCounter = 1;
  auditIdCounter = 1;
  dedupeKeysSeen = new Set();
  sendMock.mockReset();
  buildDashboardMock.mockReset();
  buildDashboardMock.mockResolvedValue({
    rows: [
      { formType: "K", recipientVendorId: 1 },
      { formType: "NEC", recipientVendorId: 2 },
      { formType: "K", recipientVendorId: 3 },
    ],
  });
  sendMock.mockResolvedValue({ messageId: "msg-1" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("periodForRun", () => {
  it("uses ISO weekly cadence in January", async () => {
    const m = await import("./dashboard-1099-monthly-email");
    expect(m.periodForRun(new Date("2026-01-15T00:00:00Z"))).toEqual({
      cadence: "weekly",
      label: "2026-W03",
    });
  });
  it("uses YYYY-MM monthly cadence outside January", async () => {
    const m = await import("./dashboard-1099-monthly-email");
    expect(m.periodForRun(new Date("2026-04-30T00:00:00Z"))).toEqual({
      cadence: "monthly",
      label: "2026-04",
    });
  });
});

describe("parseRecipients", () => {
  it("splits on newlines, commas, and semicolons and de-dupes case-insensitively", async () => {
    const m = await import("./dashboard-1099-monthly-email");
    expect(
      m.parseRecipients("a@x.com\nb@x.com, A@X.COM ;c@x.com\n\n"),
    ).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
  });
});

describe("parseFormats", () => {
  it("filters to known formats and de-dupes", async () => {
    const m = await import("./dashboard-1099-monthly-email");
    expect(m.parseFormats("pdf,csv,pdf,xml")).toEqual(["pdf", "csv"]);
    expect(m.parseFormats(" CSV ")).toEqual(["csv"]);
  });
});

describe("defaultTaxYear", () => {
  it("returns the prior calendar year", async () => {
    const m = await import("./dashboard-1099-monthly-email");
    expect(m.defaultTaxYear(new Date("2026-04-30T00:00:00Z"))).toBe(2025);
  });
});

describe("runDashboard1099MonthlyEmail", () => {
  it("returns zero counts when no settings rows are enabled", async () => {
    const { runDashboard1099MonthlyEmail } = await import(
      "./dashboard-1099-monthly-email"
    );
    const r = await runDashboard1099MonthlyEmail({
      now: new Date("2026-04-30T12:00:00Z"),
      sendOverride: sendMock as never,
      buildDashboardOverride: buildDashboardMock as never,
    });
    expect(r).toEqual({ scanned: 0, sent: 0, skipped: 0, errors: 0 });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("sends the admin packet, records audit rows, and stores their ids on the log row", async () => {
    settingsRows.push({
      id: 7,
      scope: "admin",
      partnerId: null,
      enabled: true,
      formats: "pdf,csv",
      recipientEmails: "ap@example.com\nfinance@example.com",
      taxYearOverride: null,
    });
    const { runDashboard1099MonthlyEmail } = await import(
      "./dashboard-1099-monthly-email"
    );
    const r = await runDashboard1099MonthlyEmail({
      now: new Date("2026-04-30T12:00:00Z"),
      sendOverride: sendMock as never,
      buildDashboardOverride: buildDashboardMock as never,
    });
    expect(r).toEqual({ scanned: 1, sent: 1, skipped: 0, errors: 0 });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const [arg] = sendMock.mock.calls[0]!;
    expect(arg.scope).toBe("admin");
    expect(arg.cadence).toBe("monthly");
    expect(arg.taxYear).toBe(2025);
    expect(arg.recipients).toEqual(["ap@example.com", "finance@example.com"]);
    expect(arg.attachments).toHaveLength(2);
    // K-only filter: dashboard returned 2 K rows + 1 NEC row.
    expect(buildDashboardMock).toHaveBeenCalledWith({
      year: 2025,
      payerPartnerId: undefined,
    });
    // One audit row per format.
    expect(insertedAudits).toHaveLength(2);
    expect(insertedAudits.map((a) => a.format).sort()).toEqual([
      "1099_csv",
      "1099_pdf",
    ]);
    for (const a of insertedAudits) {
      const scope = a.scope as Record<string, unknown>;
      expect(scope.sendKind).toBe("scheduled_dashboard_email");
      expect(scope.cadence).toBe("monthly");
      expect(scope.year).toBe(2025);
    }
    // The log row's reportExportAuditIdsCsv should now contain both ids.
    expect(updatedLogs).toHaveLength(1);
    const csv = updatedLogs[0]!.set.reportExportAuditIdsCsv as string;
    expect(csv.split(",").sort()).toEqual(["1", "2"]);
  });

  it("skips when the dedupe key already exists (race loser)", async () => {
    settingsRows.push({
      id: 8,
      scope: "admin",
      partnerId: null,
      enabled: true,
      formats: "pdf",
      recipientEmails: "ap@example.com",
      taxYearOverride: null,
    });
    dedupeKeysSeen.add("dashboard1099:admin:admin:2026-04");
    const { runDashboard1099MonthlyEmail } = await import(
      "./dashboard-1099-monthly-email"
    );
    const r = await runDashboard1099MonthlyEmail({
      now: new Date("2026-04-30T12:00:00Z"),
      sendOverride: sendMock as never,
      buildDashboardOverride: buildDashboardMock as never,
    });
    expect(r).toEqual({ scanned: 1, sent: 0, skipped: 1, errors: 0 });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("skips rows with empty recipients", async () => {
    settingsRows.push({
      id: 9,
      scope: "admin",
      partnerId: null,
      enabled: true,
      formats: "pdf",
      recipientEmails: "",
      taxYearOverride: null,
    });
    const { runDashboard1099MonthlyEmail } = await import(
      "./dashboard-1099-monthly-email"
    );
    const r = await runDashboard1099MonthlyEmail({
      now: new Date("2026-04-30T12:00:00Z"),
      sendOverride: sendMock as never,
      buildDashboardOverride: buildDashboardMock as never,
    });
    expect(r).toEqual({ scanned: 1, sent: 0, skipped: 1, errors: 0 });
  });

  it("uses partner scope correctly and passes payerPartnerId to the dashboard builder", async () => {
    settingsRows.push({
      id: 10,
      scope: "partner",
      partnerId: 42,
      enabled: true,
      formats: "csv",
      recipientEmails: "partner-ap@example.com",
      taxYearOverride: 2024,
    });
    partnerRows.push({ id: 42, name: "Acme LLC" });
    const { runDashboard1099MonthlyEmail } = await import(
      "./dashboard-1099-monthly-email"
    );
    const r = await runDashboard1099MonthlyEmail({
      now: new Date("2026-01-05T00:00:00Z"),
      sendOverride: sendMock as never,
      buildDashboardOverride: buildDashboardMock as never,
    });
    expect(r).toEqual({ scanned: 1, sent: 1, skipped: 0, errors: 0 });
    expect(buildDashboardMock).toHaveBeenCalledWith({
      year: 2024,
      payerPartnerId: 42,
    });
    const [arg] = sendMock.mock.calls[0]!;
    expect(arg.scope).toBe("partner");
    expect(arg.partnerName).toBe("Acme LLC");
    expect(arg.cadence).toBe("weekly");
    expect(arg.taxYear).toBe(2024);
    expect(arg.attachments).toHaveLength(1);
    expect(arg.attachments[0].filename).toMatch(/partner-42-2024\.csv$/);
  });

  it("records a failure_message on the log row when SendGrid throws", async () => {
    settingsRows.push({
      id: 11,
      scope: "admin",
      partnerId: null,
      enabled: true,
      formats: "pdf",
      recipientEmails: "ap@example.com",
      taxYearOverride: null,
    });
    sendMock.mockRejectedValueOnce(new Error("SendGrid 503"));
    const { runDashboard1099MonthlyEmail } = await import(
      "./dashboard-1099-monthly-email"
    );
    const r = await runDashboard1099MonthlyEmail({
      now: new Date("2026-04-30T12:00:00Z"),
      sendOverride: sendMock as never,
      buildDashboardOverride: buildDashboardMock as never,
    });
    expect(r).toEqual({ scanned: 1, sent: 0, skipped: 0, errors: 1 });
    expect(updatedLogs).toHaveLength(1);
    expect(updatedLogs[0]!.set.failureMessage).toBe("SendGrid 503");
  });
});
