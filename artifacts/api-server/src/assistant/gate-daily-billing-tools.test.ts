import { describe, expect, it, vi } from "vitest";
import {
  readGateBillingAction,
  recoverGateBillingAction,
} from "./gate-billing-action-recovery";
import { fleetInventoryOperationId } from "./fleet-inventory-tools";
import {
  GATE_DAILY_BILLING_TOOLS,
  gateDailyBillingToolRequest,
} from "./gate-daily-billing-tools";
import { findAskVTool } from "./tool-registry";
import {
  chatGptActionTools,
  chatGptReadableTools,
} from "./chatgpt-tool-access";
import {
  resolveExecutableWorkHubToolRequest,
  bindWorkHubToolScope,
} from "./work-hub-tool-runtime";
const station = "10000000-0000-4000-8000-000000000001",
  operationId = "20000000-0000-4000-8000-000000000001",
  actor = {
    role: "vendor",
    userId: 1,
    vendorId: 7,
    activeMembershipId: 2,
    membershipRole: "admin",
    sv: 1,
  };
const args = {
  stationId: station,
  expectedVersion: 1,
  previewFingerprint: "a".repeat(64),
  continueBilling: true,
  acknowledgeCoverageGaps: true,
  minimumCompletedDays: 31,
};
describe("Gate daily billing assistant parity", () => {
  it("exposes exact financial reads and confirmation-required writes only under the matching financial grants", () => {
    expect(GATE_DAILY_BILLING_TOOLS.map((tool) => tool.name)).toContain(
      "invoice_gate_post",
    );
    expect(findAskVTool("invoice_gate_post")).toMatchObject({
      mutating: true,
      confirmation: "required",
      execution: "server",
    });
    expect(
      chatGptActionTools(actor, ["finance:write"]).some(
        (tool) => tool.name === "invoice_gate_post",
      ),
    ).toBe(false);
    expect(
      chatGptActionTools(actor, ["finance:read", "finance:write"]).some(
        (tool) => tool.name === "invoice_gate_post",
      ),
    ).toBe(true);
    expect(
      chatGptReadableTools(actor, ["gate:read", "work_hub:read"]).some(
        (tool) => tool.name === "query_gate_daily_billing",
      ),
    ).toBe(false);
    expect(
      chatGptReadableTools(actor, ["finance:read"]).some(
        (tool) => tool.name === "query_gate_daily_billing",
      ),
    ).toBe(true);
  });
  it("uses a server-owned operation and the exact saved quote for a strictly-greater-than-30-day invoice request", () => {
    expect(
      resolveExecutableWorkHubToolRequest(
        "invoice_gate_post",
        { ...args, operationId },
        false,
        actor,
      ),
    ).toMatchObject({ requiresConfirmation: true });
    const request = resolveExecutableWorkHubToolRequest(
      "invoice_gate_post",
      { ...args, operationId },
      true,
      actor,
    );
    expect(request).toEqual({
      method: "POST",
      path: `/gate-billing/${station}/invoice-now`,
      body: {
        operationId,
        expectedVersion: 1,
        previewFingerprint: "a".repeat(64),
        continueBilling: true,
        acknowledgeCoverageGaps: true,
        minimumCompletedDays: 31,
      },
    });
    expect(
      gateDailyBillingToolRequest("query_gate_daily_billing", {
        operation: "preview",
        stationId: station,
      }),
    ).toMatchObject({
      method: "GET",
      path: `/gate-billing/${station}/preview`,
    });
  });
  it("preserves strict caller fields for rejection rather than authorizing a different company or accepting a client rate", () => {
    const injected = { ...args, vendorId: 999 };
    expect(bindWorkHubToolScope(injected, actor, "invoice_gate_post")).toEqual(
      injected,
    );
    expect(() =>
      gateDailyBillingToolRequest("invoice_gate_post", {
        ...injected,
        operationId,
      }),
    ).toThrow();
  });
});

it("uses the actual trusted ChatGPT operation identity rather than requiring a model supplied operation ID", () => {
  const key = `chatgpt:${"a".repeat(64)}`;
  const actual = resolveExecutableWorkHubToolRequest(
    "invoice_gate_post",
    { ...args, idempotencyKey: key },
    true,
    actor,
  );
  expect(actual).toMatchObject({
    method: "POST",
    body: {
      operationId: fleetInventoryOperationId({ idempotencyKey: key }),
      minimumCompletedDays: 31,
    },
  });
});
it("reads exact original billing receipt and current post without repeating a write, refusing mismatched or inaccessible results", async () => {
  const config = {
    version: 2,
    stationId: station,
    vendorId: 7,
    partnerId: 8,
    siteId: 9,
    workTypeId: 10,
    periodStartDay: "2026-10-03",
    openTicketId: 101,
    agreementReference: "Test",
    partialDayRule: "full_day",
    dailyRateCents: 10001,
    approvalId: 1,
    approvalAt: "2026-10-01T00:00:00Z",
    afe: "AFE1",
    lastBilledThroughDay: "2026-10-02",
    autoInvoiceEveryDays: null,
  };
  const op = fleetInventoryOperationId({
      idempotencyKey: `chatgpt:${"a".repeat(64)}`,
    }),
    result = {
      status: "submitted",
      ticketId: 100,
      nextTicketId: 101,
      billedThroughDay: "2026-10-02",
      invoiceStatus: "awaiting_partner_approval",
    };
  const receipt = {
    state: "completed",
    stationId: station,
    operationId: op,
    recordedAt: "2026-10-03T15:00:00Z",
    kind: "invoice_now",
    result,
  };
  const request = vi.fn(async (path: string) =>
    path.includes("/receipts/")
      ? receipt
      : {
          post: {
            id: station,
            name: "Main",
            siteId: 9,
            siteName: "Test",
            partnerId: 8,
          },
          config,
          services: [],
        },
  );
  expect(
    await readGateBillingAction("invoice_gate_post", args, op, actor, request),
  ).toMatchObject({ ...result, verified: true, operationId: op });
  expect(request.mock.calls.map((c) => c[0])).toEqual([
    `/gate-billing/${station}/receipts/${op}`,
    `/gate-billing/${station}/setup`,
  ]);
  config.openTicketId = 999;
  await expect(
    readGateBillingAction("invoice_gate_post", args, op, actor, request),
  ).rejects.toThrow("readback mismatch");
  expect(
    await recoverGateBillingAction(
      {
        toolName: "invoice_gate_post",
        tokenHash: "a".repeat(64),
        arguments: args,
      },
      actor,
      ["gate:read", "work_hub:write"],
      request,
    ),
  ).toBeNull();
});
