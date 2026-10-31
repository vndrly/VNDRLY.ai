import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { GateDailyBillingConfig } from "@workspace/api-zod";
import { calculateGateBillingPeriod } from "@workspace/api-zod";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
vi.mock("@/components/png-pill-rollover", () => ({
  PngPillButton: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
}));
import GateDailyBillingPanel from "./gate-daily-billing-panel";
const post = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Main Gate",
  siteId: 9,
  siteName: "Test Site",
  partnerId: 8,
  partnerName: "Test Partner",
};
it("lets the office choose continuation and submits the displayed server quote, then shows the independently saved billing result", async () => {
  let config: GateDailyBillingConfig = {
    version: 1,
    stationId: post.id,
    vendorId: 7,
    partnerId: 8,
    siteId: 9,
    workTypeId: 10,
    jobOfferId: 50,
    periodStartDay: "2026-10-01",
    openTicketId: 100,
    agreementReference: "Daily agreement",
    partialDayRule: "full_day",
    dailyRateCents: 10001,
    approvalId: 1,
    approvalAt: "2026-10-01T00:00:00Z",
    afe: "AFE1",
    lastBilledThroughDay: null,
    autoInvoiceEveryDays: null,
  };
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith("/posts")) return { items: [post], nextCursor: null };
    if (path.endsWith("/setup"))
      return {
        post,
        config,
        services: [
          { id: 10, name: "Daily gate service", dailyRateCents: 10001, jobOfferId: 50, afe: "AFE1" },
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
      config = {
        ...config,
        version: 2,
        openTicketId: null,
        periodStartDay: "2026-10-03",
        lastBilledThroughDay: "2026-10-02",
      };
      return {
        status: "submitted",
        ticketId: 100,
        nextTicketId: null,
        billedThroughDay: "2026-10-02",
        invoiceStatus: "awaiting_partner_approval",
      };
    }
    throw Error("Unexpected request " + path);
  });
  render(<GateDailyBillingPanel scopeKey="company7-user1" request={request} />);
  const next = await screen.findByRole("checkbox", {
    name: "Start next billing ticket",
  });
  expect(next.getAttribute("aria-checked")).toBe("true");
  expect(screen.getByText("Partner: Test Partner")).toBeTruthy();
  expect(screen.getByText("AFE: AFE1")).toBeTruthy();
  expect(screen.getByText("Job: #50 · AFE: AFE1")).toBeTruthy();
  expect((screen.getByRole("combobox", { name: "Approved daily service" }) as HTMLSelectElement).value).toBe("10:50");
  fireEvent.click(next);
  fireEvent.click(screen.getByRole("button", { name: "Invoice Now" }));
  await waitFor(() =>
    expect(
      request.mock.calls.some(([path]) => path.endsWith("/invoice-now")),
    ).toBe(true),
  );
  const body = JSON.parse(
    String(
      request.mock.calls.find(([path]) => path.endsWith("/invoice-now"))![1]
        ?.body,
    ),
  );
  expect(body).toMatchObject({
    expectedVersion: 1,
    previewFingerprint: "a".repeat(64),
    continueBilling: false,
  });
  expect(body).not.toHaveProperty("dailyRateCents");
  expect(
    await screen.findByText("Submitted ticket 100 for partner approval."),
  ).toBeTruthy();
  expect(screen.getByText("Billing stopped after this period.")).toBeTruthy();
});
