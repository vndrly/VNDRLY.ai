import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import MarketingHome from "./marketing-home";

afterEach(cleanup);

describe("VNDRLY public homepage", () => {
  it("presents the verified vendor network and both sides of the marketplace", () => {
    render(<MarketingHome />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /trusted vendor network/i,
      }),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: /for partners/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /for vendors/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /hotlist/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /vndrly gate/i })).toBeTruthy();
  });

  it("labels unfinished payments as coming soon", () => {
    render(<MarketingHome />);

    const payments = screen.getByRole("region", { name: /secure direct payments/i });
    expect(within(payments).getAllByText(/coming soon/i).length).toBeGreaterThan(0);
    expect(within(payments).queryByText(/available now|pay today/i)).toBeNull();
  });

  it("keeps public customer identities and endorsements off the page", () => {
    render(<MarketingHome />);

    expect(document.body.textContent).not.toMatch(/Exxon|Flywheel|Warwick|trusted by/i);
    expect(screen.queryByRole("link", { name: /customer|partner portal/i })).toBeNull();
  });

  it("offers clear public navigation and conversion paths", () => {
    render(<MarketingHome />);

    const navigation = screen.getByRole("navigation", { name: /public navigation/i });
    expect(within(navigation).getByRole("link", { name: /solutions/i }).getAttribute("href")).toBe("#solutions");
    expect(within(navigation).getByRole("link", { name: /for partners/i }).getAttribute("href")).toBe("#partners");
    expect(within(navigation).getByRole("link", { name: /for vendors/i }).getAttribute("href")).toBe("#vendors");
    expect(within(navigation).getByRole("link", { name: /sign in/i }).getAttribute("href")).toBe("/login");
    expect(screen.getAllByRole("link", { name: /get started/i }).length).toBeGreaterThan(1);
    expect(screen.getAllByRole("link", { name: /request a demo/i }).length).toBeGreaterThan(0);
  });

  it("uses the approved compact amber homepage treatment", () => {
    render(<MarketingHome />);

    const headline = screen.getByRole("heading", {
      level: 1,
      name: /trusted vendor network/i,
    });
    expect(headline.className).toContain("text-[27px]");
    expect(headline.className).toContain("sm:text-[45px]");
    expect(headline.className).toContain("lg:text-[54px]");

    expect(screen.getByText("Verified vendors. Connected operations.").className).toContain("text-amber-300");
    expect(screen.getByText("Featured solutions").className).toContain("text-amber-700");
    expect(screen.getByTestId("hero-fade").className).toContain("to-[#3a3d42]");

    for (const link of screen.getAllByRole("link", { name: /get started/i })) {
      expect(link.firstElementChild?.getAttribute("data-color")).toBe("amber");
    }

    const highlightTitle = screen.getByRole("heading", { name: "Verified fit" });
    expect(highlightTitle.className).toContain("text-amber-300");
    expect(highlightTitle.parentElement?.querySelector("svg")?.getAttribute("class")).toContain("text-amber-300");
  });
});
