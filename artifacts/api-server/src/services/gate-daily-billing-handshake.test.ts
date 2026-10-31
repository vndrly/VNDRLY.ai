import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const state = vi.hoisted(() => ({
  query: vi.fn(),
  freeze: vi.fn(),
  records: new Map<string, unknown>(),
  authorizedJob: true,
  ticketId: 100,
}));
vi.mock("@workspace/db", () => ({ pool: {} }));
vi.mock("./gate-change-over", () => ({
  changeOverTransaction: (fn: (c: unknown) => unknown) =>
    fn({ query: state.query }),
}));
vi.mock("./workday", () => ({
  withVerifiedWorkdayClient: (_s: unknown, _c: unknown, fn: () => unknown) =>
    fn(),
}));
vi.mock("../lib/ticket-submissions", () => ({
  freezeTicketSubmission: state.freeze,
}));
import {
  acceptedGateDailyTerms,
  createGateDailyBillingService,
} from "./gate-daily-billing";
import type { SessionPayload } from "../lib/session";

const station = "10000000-0000-4000-8000-000000000001";
const session: SessionPayload = {
  userId: 1,
  role: "vendor",
  vendorId: 7,
  activeMembershipId: 1,
  membershipRole: "admin",
  sv: 1,
};
const commercial = {
  unit: "per_day",
  unitPrice: "100.010000",
  currency: "USD",
  rateComponents: {},
};
const service = createGateDailyBillingService({
  now: () => new Date("2026-10-03T15:00:00Z"),
});
const input = () => ({
  operationId: randomUUID(),
  expectedVersion: 0,
  workTypeId: 10,
  jobOfferId: 50,
  startDay: "2026-10-01",
  agreementReference: "Partner job 50",
  partialDayRule: "full_day",
  confirmedUnbilledStart: true,
});

beforeEach(() => {
  state.records.clear();
  state.authorizedJob = true;
  state.ticketId = 100;
  state.freeze.mockReset();
  state.query
    .mockReset()
    .mockImplementation(async (sql: string, args: unknown[] = []) => {
      let rows: unknown[] = [];
      if (sql.startsWith("SELECT m.id")) rows = [{ id: 1 }];
      else if (sql.startsWith("SELECT g.id,g.name,g.site_id"))
        rows = [
          {
            id: station,
            name: "Main",
            site_id: 9,
            site_name: "Site",
            partner_id: 8,
            partner_name: "Partner",
            afe: "WRONG-SITE-DEFAULT",
          },
        ];
      else if (sql.startsWith("SELECT tool_output")) {
        const value = state.records.get(`${args[1]}:${args[2]}`);
        rows = value ? [{ tool_output: value }] : [];
      } else if (sql.startsWith("INSERT INTO assistant_action_audit"))
        state.records.set(`${args[3]}:${args[4]}`, JSON.parse(String(args[5])));
      else if (
        sql.includes("FROM job_offers j JOIN job_offer_acceptance_snapshots")
      )
        rows = state.authorizedJob
          ? [
              {
                id: 50,
                accepted_at: "2026-10-01T00:00:00Z",
                commercial_snapshot: commercial,
                scope_snapshot: { afeCode: "PARTNER-JOB-AFE" },
              },
            ]
          : [];
      else if (sql.startsWith("INSERT INTO tickets("))
        rows = [{ id: state.ticketId++ }];
      else if (sql.startsWith("UPDATE tickets t SET engagement"))
        rows = [{ id: args[0] }];
      else if (sql.startsWith("SELECT id,started_at"))
        rows = [{ id: 1, started_at: "2026-10-01T05:00:00Z", ended_at: null }];
      else if (sql.startsWith("SELECT status,engagement"))
        rows = [{ status: "initiated", engagement_job_offer_id: 50 }];
      else if (sql.startsWith("SELECT count(*)")) rows = [{ n: 0 }];
      return { rows, rowCount: rows.length };
    });
});

describe("accepted Gate job billing", () => {
  it("requires an accepted job for a new setup without retroassigning old data", async () => {
    const { jobOfferId: _, ...legacyInput } = input();
    await expect(
      service.configure(session, station, legacyInput),
    ).rejects.toThrow("accepted_job_required");
    expect(
      state.query.mock.calls.some(([sql]) =>
        sql.startsWith("INSERT INTO tickets("),
      ),
    ).toBe(false);
  });
  it("retains exact accepted price and partner AFE instead of mutable site defaults", async () => {
    const saved = await service.configure(session, station, input());
    expect(saved).toMatchObject({
      jobOfferId: 50,
      dailyRateCents: 10001,
      afe: "PARTNER-JOB-AFE",
      openTicketId: 100,
    });
    const query = state.query.mock.calls.find(([sql]) =>
      sql.includes("FROM job_offers j JOIN"),
    );
    expect(query?.[0]).toContain("a.is_gate_contractor=true");
    expect(query?.[1]).toEqual([50, 7, 8, 9, 10]);
    expect(
      state.query.mock.calls.some(
        ([sql, args]) =>
          sql.startsWith("UPDATE tickets t SET engagement") && args[1] === 50,
      ),
    ).toBe(true);
  });
  it("rejects a foreign, unaccepted, or non-Gate-authorized job without creating a ticket", async () => {
    state.authorizedJob = false;
    await expect(service.configure(session, station, input())).rejects.toThrow(
      "accepted_job_required",
    );
    expect(
      state.query.mock.calls.some(([sql]) =>
        sql.startsWith("INSERT INTO tickets("),
      ),
    ).toBe(false);
  });
  it("keeps successive periods on the same job and freezes the submitted Gate proof", async () => {
    const saved = await service.configure(session, station, input());
    const quote = await service.preview(session, station);
    const result = await service.invoiceNow(session, station, {
      operationId: randomUUID(),
      expectedVersion: saved.version,
      previewFingerprint: quote.fingerprint,
      continueBilling: true,
      acknowledgeCoverageGaps: true,
    });
    expect(result).toMatchObject({
      ticketId: 100,
      nextTicketId: 101,
      status: "submitted",
    });
    const links = state.query.mock.calls.filter(([sql]) =>
      sql.startsWith("UPDATE tickets t SET engagement"),
    );
    expect(links.map(([, args]) => args)).toEqual([
      [100, 50],
      [101, 50],
    ]);
    expect(state.freeze).toHaveBeenCalledWith(expect.anything(), 100, 1);
    expect(state.records.get("gate-billing-ticket:100")).toMatchObject({
      agreement: { jobOfferId: 50, afe: "PARTNER-JOB-AFE" },
      invoiceStatus: "awaiting_partner_approval",
    });
  });
  it.each([
    [
      { ...commercial, rateComponents: { mobilization: 20 } },
      { afeCode: "AFE" },
    ],
    [{ ...commercial, unitPrice: "100.001" }, { afeCode: "AFE" }],
    [{ ...commercial, currency: "CAD" }, { afeCode: "AFE" }],
    [commercial, { afeCode: "  " }],
  ])(
    "does not invent a daily price or AFE for unsupported accepted terms",
    (terms, scope) => {
      expect(() => acceptedGateDailyTerms(terms, scope)).toThrow();
    },
  );
});
