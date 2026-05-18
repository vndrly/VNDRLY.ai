// Stub-based unit tests for the AP payment digest worker (Task #505).
//
// We mock @workspace/db.execute so we can drive the SQL pipeline shape
// (scan -> insert dedupe -> recipients lookup) without touching Postgres.
// The real cross-instance dedupe race is exercised by the unique index
// itself; here we only verify the single-process paths.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.fn();
const findApMock = vi.fn();
const sendMock = vi.fn();

vi.mock("@workspace/db", () => ({
  db: { execute: (...args: unknown[]) => executeMock(...args) },
}));
vi.mock("./ap-role", () => ({
  findPartnerApContactEmails: (...args: unknown[]) => findApMock(...args),
}));
vi.mock("./sendgrid", () => ({
  sendAwaitingPaymentDigestEmail: (...args: unknown[]) => sendMock(...args),
}));
vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

beforeEach(() => {
  executeMock.mockReset();
  findApMock.mockReset();
  sendMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isoWeekLabel", () => {
  it("formats ISO weeks with year-W## (Thursday rule)", async () => {
    const { isoWeekLabel } = await import("./ap-payment-digest");
    // 2026-04-30 is a Thursday → ISO week 18 of 2026.
    expect(isoWeekLabel(new Date("2026-04-30T00:00:00Z"))).toBe("2026-W18");
    // 2026-01-01 is a Thursday → still ISO week 1 of 2026.
    expect(isoWeekLabel(new Date("2026-01-01T00:00:00Z"))).toBe("2026-W01");
    // 2024-12-30 (Mon) belongs to ISO week 1 of 2025.
    expect(isoWeekLabel(new Date("2024-12-30T00:00:00Z"))).toBe("2025-W01");
  });
});

describe("runApPaymentDigest", () => {
  it("returns zero counts when the scan finds no eligible tickets", async () => {
    executeMock.mockResolvedValueOnce({ rows: [] } as any);
    const { runApPaymentDigest } = await import("./ap-payment-digest");
    const r = await runApPaymentDigest(new Date("2026-04-30T12:00:00Z"));
    expect(r).toEqual({
      scanned: 0,
      digestsSent: 0,
      digestsSkipped: 0,
      errors: 0,
    });
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("sends one digest per partner and records the dedupe row", async () => {
    executeMock
      // scan
      .mockResolvedValueOnce({
        rows: [
          {
            partner_id: 7,
            partner_name: "Acme Roofing",
            ticket_id: 101,
            approved_at: "2026-04-15T00:00:00.000Z",
            total: "1250.00",
          },
          {
            partner_id: 7,
            partner_name: "Acme Roofing",
            ticket_id: 102,
            approved_at: "2026-04-18T00:00:00.000Z",
            total: "300.50",
          },
        ],
      } as any)
      // insert dedupe row → claimed
      .mockResolvedValueOnce({ rows: [{ id: 1 }] } as any);
    findApMock.mockResolvedValueOnce([
      { email: "ap@acme.test", preferredLocale: "en" },
      { email: "ap2@acme.test", preferredLocale: "es" },
    ]);
    sendMock.mockResolvedValueOnce(undefined);

    const { runApPaymentDigest } = await import("./ap-payment-digest");
    const r = await runApPaymentDigest(new Date("2026-04-30T12:00:00Z"));
    expect(r.scanned).toBe(2);
    expect(r.digestsSent).toBe(1);
    expect(r.digestsSkipped).toBe(0);
    expect(r.errors).toBe(0);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const args = sendMock.mock.calls[0]![0] as any;
    expect(args.partnerName).toBe("Acme Roofing");
    expect(args.recipients).toHaveLength(2);
    expect(args.tickets).toHaveLength(2);
    // Total reflects both line items, not just first.
    expect(args.totalAmountLabel).toMatch(/1,550/);
    expect(args.queueUrl).toContain("/tickets?awaitingPayment=true");
  });

  it("skips when the dedupe insert loses the race (no row returned)", async () => {
    executeMock
      .mockResolvedValueOnce({
        rows: [
          {
            partner_id: 9,
            partner_name: "Beta Co",
            ticket_id: 200,
            approved_at: "2026-04-15T00:00:00.000Z",
            total: "100.00",
          },
        ],
      } as any)
      // dedupe row already existed
      .mockResolvedValueOnce({ rows: [] } as any);

    const { runApPaymentDigest } = await import("./ap-payment-digest");
    const r = await runApPaymentDigest(new Date("2026-04-30T12:00:00Z"));
    expect(r.digestsSent).toBe(0);
    expect(r.digestsSkipped).toBe(1);
    expect(findApMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("marks the dedupe row with no_ap_contacts when partner has no AP recipients", async () => {
    executeMock
      .mockResolvedValueOnce({
        rows: [
          {
            partner_id: 11,
            partner_name: "Gamma LLC",
            ticket_id: 300,
            approved_at: "2026-04-10T00:00:00.000Z",
            total: "750.00",
          },
        ],
      } as any)
      // dedupe insert claimed
      .mockResolvedValueOnce({ rows: [{ id: 5 }] } as any)
      // failure_message update
      .mockResolvedValueOnce({ rows: [] } as any);
    findApMock.mockResolvedValueOnce([]);

    const { runApPaymentDigest } = await import("./ap-payment-digest");
    const r = await runApPaymentDigest(new Date("2026-04-30T12:00:00Z"));
    expect(r.digestsSent).toBe(0);
    expect(r.digestsSkipped).toBe(1);
    expect(sendMock).not.toHaveBeenCalled();
    // The 3rd execute call must be the failure_message UPDATE.
    const updateCall = executeMock.mock.calls[2]![0] as any;
    expect(JSON.stringify(updateCall)).toContain("no_ap_contacts");
  });

  it("records failure_message and increments errors when sendgrid throws", async () => {
    executeMock
      .mockResolvedValueOnce({
        rows: [
          {
            partner_id: 13,
            partner_name: "Delta Inc",
            ticket_id: 400,
            approved_at: "2026-04-20T00:00:00.000Z",
            total: "200.00",
          },
        ],
      } as any)
      .mockResolvedValueOnce({ rows: [{ id: 9 }] } as any)
      // failure_message update
      .mockResolvedValueOnce({ rows: [] } as any);
    findApMock.mockResolvedValueOnce([
      { email: "ap@delta.test", preferredLocale: "en" },
    ]);
    sendMock.mockRejectedValueOnce(new Error("SendGrid 500"));

    const { runApPaymentDigest } = await import("./ap-payment-digest");
    const r = await runApPaymentDigest(new Date("2026-04-30T12:00:00Z"));
    expect(r.digestsSent).toBe(0);
    expect(r.errors).toBe(1);
    const updateCall = executeMock.mock.calls[2]![0] as any;
    expect(JSON.stringify(updateCall)).toContain("SendGrid 500");
  });
});
