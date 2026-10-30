import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { X } from "lucide-react";
import PngPill, { PngPillButton, PngPillLink } from "@/components/png-pill-rollover";
import BrandPillButton from "@/components/brand-pill-button";
vi.mock("@/hooks/use-brand", () => ({ useBrand: () => ({ primary: "#eabf38", name: "GateGo" }) }));

describe("pill action styling scope", () => {
  it("marks labelled pill buttons and links, while preserving icons and read-only badges", () => {
    render(<>
      <PngPillButton>Save</PngPillButton>
      <PngPillButton aria-label="Close"><X /><span className="sr-only">Close</span></PngPillButton>
      <BrandPillButton><X />Cancel</BrandPillButton>
      <BrandPillButton aria-label="Dismiss"><X /></BrandPillButton>
      <PngPillLink href="/record">View record</PngPillLink>
      <PngPill data-testid="status-badge">Active</PngPill>
    </>);
    for (const name of ["Save", "Cancel"]) expect(screen.getByRole("button", { name }).getAttribute("data-modal-pill-action")).toBe("true");
    for (const name of ["Close", "Dismiss"]) expect(screen.getByRole("button", { name }).hasAttribute("data-modal-pill-action")).toBe(false);
    expect(screen.getByRole("link", { name: "View record" }).getAttribute("data-modal-pill-action")).toBe("true");
    expect(screen.getByTestId("status-badge").hasAttribute("data-modal-pill-action")).toBe(false);
  });
});
