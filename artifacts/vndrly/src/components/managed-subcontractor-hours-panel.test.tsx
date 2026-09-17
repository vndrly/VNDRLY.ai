import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PILL_ACTION } from "@/lib/pill-palette-assets";
import ManagedSubcontractorHoursPanel from "./managed-subcontractor-hours-panel";

describe("ManagedSubcontractorHoursPanel", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders Download PDF with the requested red action pill", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          organization: { id: "sub-1", name: "NewTech" },
          approvalPolicy: "either",
          approved: false,
          totals: {
            scheduledMinutes: 480,
            actualMinutes: 450,
            approvedMinutes: 0,
          },
          lines: [],
          recipients: [],
        }),
      }),
    );

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ManagedSubcontractorHoursPanel
          vendorId={1054}
          companies={[{ id: "sub-1", name: "NewTech" }]}
          start="2026-09-01T00:00:00.000Z"
          end="2026-10-01T00:00:00.000Z"
          showSettings
        />
      </QueryClientProvider>,
    );

    const download = await screen.findByRole("button", { name: "Download PDF" });
    expect(screen.getByTestId("managed-subcontractor-hours-panel").className).toContain(
      "border-[color:var(--brand-primary)]",
    );
    expect(screen.getByTestId("select-subcontractor-approval-rule").className).toContain("rounded-full");
    expect(screen.getByTestId("select-subcontractor-approval-rule").className).toContain("border-[color:var(--brand-primary)]");
    expect(screen.getByTestId("input-subcontractor-email-recipients").className).toContain("bg-white");
    expect(screen.getByTestId("input-subcontractor-email-recipients").className).toContain("rounded-full");
    expect(
      [...download.querySelectorAll("img")].some(
        (image) => image.getAttribute("src") === PILL_ACTION.red,
      ),
    ).toBe(true);
  });
});
