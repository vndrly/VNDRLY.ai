// Stub-based unit tests for the certification reminder worker
// (Task #45). We mock @workspace/db so the scan -> claim -> digest
// pipeline can be driven without touching Postgres. The cross-instance
// dedupe race is exercised by the unique index on
// certification_reminder_log.dedupe_key itself.
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const certRows: unknown[] = [];
const vendorMembershipRows: unknown[] = [];
const adminUserRows: unknown[] = [];
const insertedLogs: Array<Record<string, unknown>> = [];
const updatedLogs: Array<{ keys: string[]; set: Record<string, unknown> }> = [];
const existingLogByKey = new Map<
  string,
  { failureMessage: string | null }
>();
let logIdCounter = 1;
const sendVendorMock = vi.fn();
const sendAdminMock = vi.fn();

vi.mock("@workspace/db", () => {
  // Discriminate joins by which "from" table started the chain. Joins
  // are no-ops here — every join target is just a pass-through and the
  // shape of the returned rows is whatever was queued for that table.
  const employeeCertificationsTable = { __tag: "certs" } as const;
  const fieldEmployeesTable = { __tag: "fieldEmployees" } as const;
  const vendorsTable = { __tag: "vendors" } as const;
  const userOrgMembershipsTable = { __tag: "memberships" } as const;
  const usersTable = { __tag: "users" } as const;
  const notificationPreferencesTable = { __tag: "prefs" } as const;
  const certificationReminderLogTable = {
    __tag: "log",
    dedupeKey: { __col: "dedupe_key" },
  } as const;

  function selectChain(rowsRef: () => unknown[]): Record<string, unknown> {
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.innerJoin = () => chain;
    chain.leftJoin = () => chain;
    chain.where = () => chain;
    chain.limit = () => chain;
    chain.then = (resolve: (rows: unknown[]) => unknown) =>
      resolve(rowsRef());
    return chain;
  }

  return {
    employeeCertificationsTable,
    fieldEmployeesTable,
    vendorsTable,
    userOrgMembershipsTable,
    usersTable,
    notificationPreferencesTable,
    certificationReminderLogTable,
    db: {
      select: () => ({
        from: (table: { __tag: string }) => {
          if (table.__tag === "certs") return selectChain(() => certRows);
          if (table.__tag === "memberships")
            return selectChain(() => vendorMembershipRows);
          if (table.__tag === "users")
            return selectChain(() => adminUserRows);
          if (table.__tag === "log") {
            // Used by claimTrigger when an INSERT lost the race; we
            // look up the existing row by dedupe_key. The chain
            // resolves to a single-element array if we have one.
            const chain: Record<string, unknown> = {};
            chain.from = () => chain;
            chain.where = (predicate: unknown) => {
              // Drizzle's eq returns an opaque object; we stash the
              // intended dedupe_key on the predicate from the test by
              // having the production code call eq(col, key) — we
              // can't see the args here, so instead the test queues
              // existing rows by key and the chain resolves to "the
              // most recently queued row", which suffices for the
              // single-cert paths below.
              void predicate;
              const last = Array.from(existingLogByKey.values()).pop();
              return {
                then: (resolve: (rows: unknown[]) => unknown) =>
                  resolve(last ? [last] : []),
              };
            };
            return chain;
          }
          throw new Error(`unexpected select table ${table.__tag}`);
        },
      }),
      insert: (table: { __tag: string }) => {
        if (table.__tag !== "log") {
          throw new Error(`unexpected insert table ${table.__tag}`);
        }
        return {
          values: (vals: Record<string, unknown>) => ({
            onConflictDoNothing: () => ({
              returning: async () => {
                const key = vals.dedupeKey as string;
                if (existingLogByKey.has(key)) return [];
                existingLogByKey.set(key, { failureMessage: null });
                const id = logIdCounter++;
                insertedLogs.push({ id, ...vals });
                return [{ id }];
              },
            }),
          }),
        };
      },
      update: (table: { __tag: string }) => ({
        set: (set: Record<string, unknown>) => ({
          where: async (_predicate: unknown) => {
            // For test purposes, capture the update so assertions can
            // see whether failures cleared / failure messages were
            // stamped.
            updatedLogs.push({ keys: [], set });
            // If the update flips failure_message, mirror that into
            // the in-memory map so a follow-up claimTrigger sees the
            // up-to-date state.
            if ("failureMessage" in set) {
              for (const v of existingLogByKey.values()) {
                v.failureMessage = (set.failureMessage as string | null) ?? null;
              }
            }
          },
        }),
      }),
    },
  };
});

vi.mock("./sendgrid", () => ({
  sendCertExpirationVendorDigestEmail: (...args: unknown[]) =>
    sendVendorMock(...args),
  sendCertExpirationAdminDigestEmail: (...args: unknown[]) =>
    sendAdminMock(...args),
}));
vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

beforeEach(() => {
  certRows.length = 0;
  vendorMembershipRows.length = 0;
  adminUserRows.length = 0;
  insertedLogs.length = 0;
  updatedLogs.length = 0;
  existingLogByKey.clear();
  logIdCounter = 1;
  sendVendorMock.mockReset();
  sendAdminMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("targetExpirationDateUtc", () => {
  it("computes today + N days as a UTC YYYY-MM-DD literal", async () => {
    const { targetExpirationDateUtc } = await import(
      "./certification-reminder-worker"
    );
    expect(
      targetExpirationDateUtc(new Date("2026-05-01T12:00:00Z"), 60),
    ).toBe("2026-06-30");
    expect(
      targetExpirationDateUtc(new Date("2026-05-01T12:00:00Z"), 30),
    ).toBe("2026-05-31");
    expect(
      targetExpirationDateUtc(new Date("2026-05-01T12:00:00Z"), 7),
    ).toBe("2026-05-08");
  });

  it("ignores local TZ — late-evening UTC stays on the same day", async () => {
    const { targetExpirationDateUtc } = await import(
      "./certification-reminder-worker"
    );
    expect(
      targetExpirationDateUtc(new Date("2026-05-01T23:59:00Z"), 7),
    ).toBe("2026-05-08");
  });
});

describe("runCertificationReminderScan", () => {
  it("returns zero counts when no certs match any threshold", async () => {
    const { runCertificationReminderScan } = await import(
      "./certification-reminder-worker"
    );
    const r = await runCertificationReminderScan(
      new Date("2026-05-01T12:00:00Z"),
    );
    expect(r.scanned).toBe(0);
    expect(r.triggersFired).toBe(0);
    expect(sendVendorMock).not.toHaveBeenCalled();
    expect(sendAdminMock).not.toHaveBeenCalled();
  });

  it("claims a trigger, sends a vendor digest, then sends an admin digest", async () => {
    // One cert matching the 30-day threshold for vendor 7.
    certRows.push({
      certificationId: 100,
      certName: "OSHA 10",
      certIssuer: "OSHA",
      expirationDate: "2026-05-31",
      employeeId: 9,
      employeeFirstName: "Jane",
      employeeLastName: "Doe",
      vendorId: 7,
      vendorName: "Acme Roofing",
    });
    vendorMembershipRows.push({
      id: 1,
      email: "vendor@acme.test",
      username: "vendor@acme.test",
      suspendedAt: null,
      complianceEnabled: true,
    });
    adminUserRows.push({
      id: 2,
      email: "admin@vndrly.test",
      username: "admin@vndrly.test",
      suspendedAt: null,
      complianceEnabled: true,
    });

    sendVendorMock.mockResolvedValue({ messageId: "v-1" });
    sendAdminMock.mockResolvedValue({ messageId: "a-1" });

    const { runCertificationReminderScan } = await import(
      "./certification-reminder-worker"
    );
    const r = await runCertificationReminderScan(
      new Date("2026-05-01T12:00:00Z"),
    );
    // Three threshold scans (60/30/7). Only the 30d scan returned a
    // row in our fixture (the same `certRows` array is returned for
    // every threshold scan because the mock is identity-keyed by
    // table, not by predicate). So in this test we assert the
    // pipeline sends *exactly* one digest per claimed trigger and
    // ignores the duplicates via dedupe.
    expect(r.triggersFired).toBeGreaterThanOrEqual(1);
    expect(sendVendorMock).toHaveBeenCalledTimes(1);
    const vendorCall = sendVendorMock.mock.calls[0]![0] as {
      vendorName: string;
      recipients: string[];
      rows: Array<{ employeeName: string; daysUntilExpiration: number }>;
    };
    expect(vendorCall.vendorName).toBe("Acme Roofing");
    expect(vendorCall.recipients).toEqual(["vendor@acme.test"]);
    expect(vendorCall.rows[0]!.employeeName).toBe("Jane Doe");
    expect(sendAdminMock).toHaveBeenCalledTimes(1);
    const adminCall = sendAdminMock.mock.calls[0]![0] as {
      vendorCount: number;
      recipients: string[];
    };
    expect(adminCall.vendorCount).toBe(1);
    expect(adminCall.recipients).toEqual(["admin@vndrly.test"]);
    // Dedupe row should be present.
    expect(insertedLogs.length).toBeGreaterThanOrEqual(1);
    const firstLog = insertedLogs[0]!;
    expect(firstLog.dedupeKey).toMatch(/^cert_expiration:\d+d:100$/);
  });

  it("skips vendor digest with no eligible recipients and stamps a failure message", async () => {
    certRows.push({
      certificationId: 200,
      certName: "TWIC",
      certIssuer: null,
      expirationDate: "2026-05-08",
      employeeId: 11,
      employeeFirstName: "Sam",
      employeeLastName: "Spade",
      vendorId: 8,
      vendorName: "Beta Co",
    });
    // Vendor user is suspended → filtered out → 0 recipients.
    vendorMembershipRows.push({
      id: 3,
      email: "muted@beta.test",
      username: "muted@beta.test",
      suspendedAt: new Date("2026-04-01T00:00:00Z"),
      complianceEnabled: true,
    });
    adminUserRows.push({
      id: 4,
      email: "admin@vndrly.test",
      username: "admin@vndrly.test",
      suspendedAt: null,
      complianceEnabled: true,
    });
    sendAdminMock.mockResolvedValue({ messageId: "a-2" });

    const { runCertificationReminderScan } = await import(
      "./certification-reminder-worker"
    );
    const r = await runCertificationReminderScan(
      new Date("2026-05-01T12:00:00Z"),
    );
    expect(sendVendorMock).not.toHaveBeenCalled();
    expect(r.vendorDigestsSkippedNoRecipients).toBeGreaterThanOrEqual(1);
    // Admin digest still goes out for visibility.
    expect(sendAdminMock).toHaveBeenCalledTimes(1);
    // Failure message captured on the dedupe row.
    const setHits = updatedLogs.filter(
      (u) => u.set.failureMessage === "no_vendor_recipients",
    );
    expect(setHits.length).toBeGreaterThanOrEqual(1);
  });

  it("stamps SendGrid errors as failure_message so the next run retries", async () => {
    certRows.push({
      certificationId: 300,
      certName: "First Aid",
      certIssuer: "Red Cross",
      expirationDate: "2026-05-08",
      employeeId: 13,
      employeeFirstName: "Pat",
      employeeLastName: "Q",
      vendorId: 9,
      vendorName: "Gamma LLC",
    });
    vendorMembershipRows.push({
      id: 5,
      email: "vendor@gamma.test",
      username: "vendor@gamma.test",
      suspendedAt: null,
      complianceEnabled: true,
    });
    adminUserRows.push({
      id: 6,
      email: "admin@vndrly.test",
      username: "admin@vndrly.test",
      suspendedAt: null,
      complianceEnabled: true,
    });
    sendVendorMock.mockRejectedValue(new Error("sendgrid 5xx"));
    sendAdminMock.mockResolvedValue({ messageId: "a-3" });

    const { runCertificationReminderScan } = await import(
      "./certification-reminder-worker"
    );
    const r = await runCertificationReminderScan(
      new Date("2026-05-01T12:00:00Z"),
    );
    expect(r.vendorDigestsFailed).toBeGreaterThanOrEqual(1);
    const stamped = updatedLogs.filter(
      (u) => typeof u.set.failureMessage === "string" &&
        (u.set.failureMessage as string).includes("sendgrid 5xx"),
    );
    expect(stamped.length).toBeGreaterThanOrEqual(1);
  });
});
