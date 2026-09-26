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
    expect(screen.getByText("Maintained by the people doing the work").className).toContain("text-white");

    for (const copy of [
      "Services, geography, eligibility, and current operational context.",
      "Ratings and activity signals grounded in completed work.",
      "Find qualified providers fast through our network of vendors.",
      "All transactions are audited for security 24/7",
    ]) {
      expect(screen.getByText(copy).className).toContain("text-white");
    }
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
      expect(screen.getByRole("heading", { name: title }).className).toContain("text-white");
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

  it("keeps featured card borders uniform and uses bold amber benefit checks", () => {
    render(<MarketingHome />);

    for (const title of ["Hotlist", "VNDRLY Gate"]) {
      const card = screen.getByRole("heading", { name: title }).closest("article");
      expect(card?.className).toContain("border-2");
      expect(card?.className).toContain("bg-[#2b3035]");
      expect(card?.innerHTML).not.toContain("absolute inset-x-0 top-0 h-1");

      expect(card?.querySelector("p.leading-7")?.className).toContain("text-slate-300");
      for (const item of card?.querySelectorAll("li") ?? []) {
        expect(item.className).toContain("text-white");
      }

      const checks = card?.querySelectorAll("li svg") ?? [];
      expect(checks.length).toBeGreaterThan(0);
      for (const check of checks) {
        expect(check.getAttribute("class")).toContain("text-[var(--vndrly-amber)]");
        expect(check.getAttribute("stroke-width")).toBe("3");
      }
    }
  });

  it("uses charcoal partner and vendor cards with exact VNDRLY amber accents", () => {
    render(<MarketingHome />);

    for (const [name, label] of [[/^For partners:/i, "For operating partners"], [/^For vendors:/i, "For vendors"]] as const) {
      const card = screen.getByRole("heading", { name }).closest("article");
      expect(card?.className).toContain("bg-[#2b3035]");
      expect(card?.className).toContain("border-[var(--vndrly-amber)]");
      const labelElement = within(card as HTMLElement).getByText(label, { exact: true });
      expect(labelElement.parentElement?.className).toContain("flex");
      expect(labelElement.className).toContain("text-base");
      expect(labelElement.className).toContain("font-black");
      expect(labelElement.previousElementSibling?.getAttribute("class")).toContain("text-[var(--vndrly-amber)]");
      expect(card?.querySelector("h2")?.className).toContain("text-2xl");
      expect(card?.querySelector("h2")?.className).toContain("text-white");
      for (const item of card?.querySelectorAll("li") ?? []) {
        expect(item.className).toContain("text-white");
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
