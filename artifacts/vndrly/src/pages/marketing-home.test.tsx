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
});
