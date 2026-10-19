import { expect, it, vi } from "vitest";
import { createGateDailyBillingWorkflow } from "./gate-daily-billing-client";
import type { GateDailyBillingConfig } from "./gate-daily-billing";
import { calculateGateBillingPeriod } from "./gate-billing-period";
const station = "10000000-0000-4000-8000-000000000001",
  operation = "20000000-0000-4000-8000-000000000001";
function fixture() {
  let config: GateDailyBillingConfig = {
      version: 1,
      stationId: station,
      vendorId: 7,
      partnerId: 8,
      siteId: 9,
      workTypeId: 10,
      periodStartDay: "2026-10-01",
      openTicketId: 100,
      agreementReference: "Approved agreement",
      partialDayRule: "full_day",
      dailyRateCents: 10001,
      approvalId: 1,
      approvalAt: "2026-10-01T00:00:00Z",
      afe: "AFE1",
      lastBilledThroughDay: null,
      autoInvoiceEveryDays: null,
    },
    failOnce = false,
    staleRead = false;
  const post = {
      id: station,
      name: "Main Gate",
      siteId: 9,
      siteName: "Site1",
      partnerId: 8,
    },
    receipt = {
      status: "submitted",
      ticketId: 100,
      nextTicketId: 101,
      billedThroughDay: "2026-10-02",
      invoiceStatus: "awaiting_partner_approval",
    };
  const request = vi.fn(
    async (path: string, init?: RequestInit): Promise<unknown> => {
      if (path.endsWith("/posts")) return { items: [post], nextCursor: null };
      if (path.endsWith("/setup"))
        return {
          post,
          config,
          services: [
            { id: 10, name: "Gate daily coverage", dailyRateCents: 10001 },
          ],
        };
      if (path.endsWith("/preview"))
        return {
          config,
          period: calculateGateBillingPeriod({
            startDay: config.periodStartDay,
            now: "2026-10-03T15:00:00Z",
            dailyRateCents: 10001,
            coverage: [{ startedAt: "2026-10-01T05:00:00Z", endedAt: null }],
          }),
          fingerprint: "a".repeat(64),
          invoiceStatus: "awaiting_partner_approval",
        };
      if (path.endsWith("/invoice-now")) {
        if (failOnce) {
          failOnce = false;
          throw Error("Connection lost after send");
        }
        if (!staleRead)
          config = {
            ...config,
            version: 2,
            openTicketId: 101,
            periodStartDay: "2026-10-03",
            lastBilledThroughDay: "2026-10-02",
          };
        return receipt;
      }
      if (path.endsWith("/configure")) {
        const body = JSON.parse(String(init?.body));
        config = {
          ...config,
          version: 2,
          autoInvoiceEveryDays: body.autoInvoiceEveryDays,
        };
        return config;
      }
      throw Error("Unexpected request " + path);
    },
  );
  const id = vi.fn(() => operation),
    workflow = createGateDailyBillingWorkflow({ request, operationId: id });
  return {
    request,
    id,
    workflow,
    staleRead: () => {
      staleRead = true;
    },
    loseNext: () => {
      failOnce = true;
    },
  };
}
it("retains and retries the exact billing request after an unknown network outcome and displays only the canonical submission result", async () => {
  const f = fixture();
  await f.workflow.load();
  expect(f.workflow.getSnapshot().preview?.config.openTicketId).toBe(100);
  f.loseNext();
  await f.workflow.invoiceNow(true);
  expect(f.workflow.getSnapshot().pending?.kind).toBe("invoice_now");
  await f.workflow.retry();
  const sent = f.request.mock.calls.filter(([path]) =>
    path.endsWith("/invoice-now"),
  );
  expect(sent).toHaveLength(2);
  expect(sent[0][1]?.body).toBe(sent[1][1]?.body);
  expect(f.id).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(sent[0][1]?.body))).toMatchObject({
    operationId: operation,
    expectedVersion: 1,
    previewFingerprint: "a".repeat(64),
    continueBilling: true,
  });
  expect(f.workflow.getSnapshot()).toMatchObject({
    pending: null,
    result: {
      status: "submitted",
      ticketId: 100,
      invoiceStatus: "awaiting_partner_approval",
    },
  });
});
it("does not enable recurring billing or accept client pricing while saving the approved post setup", async () => {
  const f = fixture();
  await f.workflow.load();
  await f.workflow.configure({
    workTypeId: 10,
    startDay: "2026-10-01",
    agreementReference: "Approved agreement",
    partialDayRule: "full_day",
    confirmedUnbilledStart: true,
    autoInvoiceEveryDays: null,
  });
  const call = f.request.mock.calls.find(([path]) =>
      path.endsWith("/configure"),
    )!,
    body = JSON.parse(String(call[1]?.body));
  expect(body.autoInvoiceEveryDays).toBeNull();
  expect(body).not.toHaveProperty("dailyRateCents");
  expect(body).not.toHaveProperty("vendorId");
  expect(body).not.toHaveProperty("cutoff");
});

it("does not report a confirmed billing result from the command echo when the independent canonical period does not match", async () => {
  const f = fixture();
  await f.workflow.load();
  f.staleRead();
  await f.workflow.invoiceNow(true);
  expect(f.workflow.getSnapshot().pending?.kind).toBe("invoice_now");
  expect(f.workflow.getSnapshot().errorCode).toBe(
    "gate_billing.response_unconfirmed",
  );
  expect(f.workflow.getSnapshot().result).toBeNull();
});
