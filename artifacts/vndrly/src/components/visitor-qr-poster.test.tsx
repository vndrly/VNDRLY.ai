import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("qrcode.react", () => ({
  QRCodeSVG: ({ "data-testid": testId, value }: { "data-testid": string; value: string }) => (
    <svg data-testid={testId} data-value={value} />
  ),
}));

import VisitorQrPoster from "./visitor-qr-poster";
import { DEFAULT_BRAND_PRIMARY } from "@/lib/brand-colors";

const baseSite = {
  id: 42,
  name: "Acme Site",
  address: "1 Main St",
  siteCode: "ACM-001",
};

describe("VisitorQrPoster", () => {
  it("falls back to the default brand color when no colors are provided", () => {
    render(<VisitorQrPoster site={baseSite} />);
    const poster = screen.getByTestId(`visitor-qr-poster-${baseSite.id}`);
    const title = screen.getByTestId(`text-print-title-${baseSite.id}`);
    expect(poster.style.borderColor).toBeTruthy();
    expect(title.style.color).toBe(poster.style.borderColor);
    expect(DEFAULT_BRAND_PRIMARY).toBe("#e6ac00");
  });

  it("applies the partner's primary color to the poster border, QR frame, and title", () => {
    render(
      <VisitorQrPoster
        site={baseSite}
        primaryColor="#ff8800"
        accentColor="#00aa55"
      />,
    );
    const poster = screen.getByTestId(`visitor-qr-poster-${baseSite.id}`);
    const title = screen.getByTestId(`text-print-title-${baseSite.id}`);
    expect(poster.style.borderColor).toBe("rgb(255, 136, 0)");
    expect(title.style.color).toBe("rgb(255, 136, 0)");

    const howTo = screen.getByText("How to sign in");
    expect((howTo as HTMLElement).style.color).toBe("rgb(0, 170, 85)");

    const qr = screen.getByTestId(`qr-visitor-${baseSite.id}`);
    const qrFrame = qr.parentElement as HTMLElement;
    expect(qrFrame.style.borderColor).toBe("rgb(255, 136, 0)");
  });

  it("falls back to the primary color for headings when no accent is provided", () => {
    render(<VisitorQrPoster site={baseSite} primaryColor="#123456" />);
    const howTo = screen.getByText("How to sign in");
    expect((howTo as HTMLElement).style.color).toBe("rgb(18, 52, 86)");
  });
});
