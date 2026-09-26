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

    expect(screen.getByText("Verified vendors. Connected operations.").className).toContain("text-[var(--vndrly-amber)]");
    expect(screen.getByText("Featured solutions").className).toContain("text-[var(--vndrly-amber)]");
    expect(screen.getByTestId("hero-fade").className).toContain("to-[#3a3d42]");

    for (const link of screen.getAllByRole("link", { name: /get started/i })) {
      expect(link.firstElementChild?.getAttribute("data-color")).toBe("amber");
    }

    const highlightTitle = screen.getByRole("heading", { name: "Verified fit" });
    expect(highlightTitle.className).toContain("text-[var(--vndrly-amber)]");
    expect(highlightTitle.parentElement?.querySelector("svg")?.getAttribute("class")).toContain("text-[var(--vndrly-amber)]");
  });

  it("uses the exact VNDRLY amber for public actions and navigation", () => {
    render(<MarketingHome />);

    const navigation = screen.getByRole("navigation", { name: /public navigation/i });
    for (const label of ["Solutions", "How it works", "For partners", "For vendors", "Sign in"]) {
      expect(within(navigation).getByRole("link", { name: label }).className).toContain("hover:text-[var(--vndrly-amber)]");
    }

    for (const link of screen.getAllByRole("link", { name: /request a demo/i })) {
      expect(link.className).toContain("hover:text-[var(--vndrly-amber)]");
      if (link.className.includes("rounded-full")) {
        expect(link.className).toContain("hover:border-[var(--vndrly-amber)]");
      }
    }

    expect(screen.getByText("A living vendor directory").className).toContain("text-[var(--vndrly-amber)]");
    expect(screen.getByText("Maintained by the people doing the work").className).toContain("text-slate-300");
  });

  it("uses compact section headings and exact VNDRLY amber card treatments", () => {
    render(<MarketingHome />);

    const solutionsHeading = screen.getByRole("heading", { name: "Put the network to work." });
    expect(solutionsHeading.className).toContain("text-[23px]");
    expect(solutionsHeading.className).toContain("sm:text-[36px]");

    for (const title of ["Hotlist", "VNDRLY Gate"]) {
      const card = screen.getByRole("heading", { name: title }).closest("article");
      expect(card?.className).toContain("border-[var(--vndrly-amber)]");
      expect(card?.querySelector("svg")?.getAttribute("class")).toContain("text-[var(--vndrly-amber)]");
      expect(screen.getByRole("heading", { name: title }).className).toContain("text-[var(--vndrly-amber)]");
    }

    const workflowHeading = screen.getByRole("heading", {
      name: /approval-ready record/i,
    });
    expect(workflowHeading.className).toContain("text-[23px]");
    expect(workflowHeading.className).toContain("sm:text-[36px]");

    for (const card of within(screen.getByRole("list", { name: /job workflow/i })).getAllByRole("listitem")) {
      expect(card.className).toContain("border-[var(--vndrly-amber)]");
      expect(card.querySelector("h3")?.className).toContain("text-[var(--vndrly-amber)]");
    }
  });

  it("uses charcoal partner and vendor cards with exact VNDRLY amber accents", () => {
    render(<MarketingHome />);

    for (const name of [/^For partners:/i, /^For vendors:/i]) {
      const card = screen.getByRole("heading", { name }).closest("article");
      expect(card?.className).toContain("bg-[#2b3035]");
      expect(card?.className).toContain("border-[var(--vndrly-amber)]");
      expect(card?.querySelector("svg")?.getAttribute("class")).toContain("text-[var(--vndrly-amber)]");
      expect(card?.querySelector("h2")?.className).toContain("text-[var(--vndrly-amber)]");
      for (const item of card?.querySelectorAll("li") ?? []) {
        expect(item.className).toContain("text-slate-300");
      }
    }
  });

  it("uses only the exact VNDRLY amber across public branded accents", () => {
    render(<MarketingHome />);

    expect(screen.getByTestId("marketing-home").style.getPropertyValue("--vndrly-amber")).toBe("#F59E0B");

    const offBrandAmber = [...document.querySelectorAll("[class]")]
      .map((element) => element.getAttribute("class") ?? "")
      .filter((className) =>
        /(?:text|border|bg|ring)-(?:amber|orange)-\d+/.test(className) || className.includes("#F59E0B"),
      );

    expect(offBrandAmber).toEqual([]);
  });

  it("uses the approved network and security language", () => {
    render(<MarketingHome />);

    expect(screen.getByText("Find qualified providers fast through our network of vendors.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Security aware" })).toBeTruthy();
    expect(screen.getByText("All transactions are audited for security 24/7")).toBeTruthy();
    expect(screen.queryByText("Permission aware")).toBeNull();
  });
});
