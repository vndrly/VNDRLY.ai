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
    const signIn = within(navigation).getByRole("link", { name: /sign in/i });
    expect(signIn.getAttribute("href")).toBe("/login");
    expect(signIn.getAttribute("data-color")).toBe("amber");
    expect(signIn.style.height).toBe("30px");
    expect(signIn.querySelector("span")?.className).toContain("text-[15px]");
    expect(signIn.querySelector("span")?.className).toContain("font-black");
    expect(within(navigation).queryByRole("link", { name: /get started/i })).toBeNull();
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

    for (const title of ["Verified fit", "Earned reputation", "Faster discovery", "Security aware"]) {
      const highlightTitle = screen.getByRole("heading", { name: title });
      expect(highlightTitle.className).toContain("text-white");
      expect(highlightTitle.parentElement?.className).toContain("flex");
      expect(highlightTitle.previousElementSibling?.getAttribute("class")).toContain("text-[var(--vndrly-amber)]");
    }
  });

  it("uses compact 25px conversion pills and a centered halftone-only hero", () => {
    render(<MarketingHome />);

    const primaryActions = screen.getAllByTestId("marketing-primary-cta");
    const demoActions = screen.getAllByTestId("marketing-demo-cta");
    expect(primaryActions).toHaveLength(2);
    expect(demoActions).toHaveLength(2);

    for (const action of [...primaryActions, ...demoActions]) {
      expect(action.style.height).toBe("25px");
      expect(action.className).toContain("text-[13px]");
      expect(action.className).toContain("font-bold");
    }

    const hero = screen.getByTestId("marketing-hero");
    expect(within(hero).queryByTestId("hero-photo")).toBeNull();
    const heroHalftone = within(hero).getByTestId("hero-halftone");
    expect(heroHalftone.className).toContain("left-1/2");
    expect(heroHalftone.className).toContain("top-1/2");
    expect(heroHalftone.className).toContain("-translate-x-1/2");
    expect(heroHalftone.className).toContain("-translate-y-1/2");
    expect(heroHalftone.className).toContain("w-[86rem]");
  });

  it("uses the exact VNDRLY amber for public actions and navigation", () => {
    render(<MarketingHome />);

    const navigation = screen.getByRole("navigation", { name: /public navigation/i });
    for (const label of ["Solutions", "How it works", "For partners", "For vendors"]) {
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
      const productHeading = screen.getByRole("heading", { name: title });
      const card = productHeading.closest("article");
      expect(card?.className).toContain("border-[var(--vndrly-amber)]");
      expect(card?.querySelector("svg")?.getAttribute("class")).toContain("text-[var(--vndrly-amber)]");
      expect(productHeading.className).toContain("text-2xl");
      expect(productHeading.className).toContain("text-white");
      expect(productHeading.parentElement?.className).toContain("flex");
      expect(productHeading.previousElementSibling?.tagName).toBe("svg");
    }

    const workflowHeading = screen.getByRole("heading", {
      name: /approval-ready record/i,
    });
    expect(workflowHeading.className).toContain("text-[23px]");
    expect(workflowHeading.className).toContain("sm:text-[36px]");

    for (const card of within(screen.getByRole("list", { name: /job workflow/i })).getAllByRole("listitem")) {
      expect(card.className).toContain("border-[var(--vndrly-amber)]");
      expect(card.querySelector("h3")).toBeNull();
    }
  });

  it("places a number-free seven-stage lifecycle stepper above white workflow blurbs", () => {
    render(<MarketingHome />);

    const stepper = screen.getByRole("list", { name: /job lifecycle progress/i });
    const cards = screen.getByRole("list", { name: /job workflow/i });
    const stepperItems = within(stepper).getAllByRole("listitem");
    const workflowCards = within(cards).getAllByRole("listitem");

    expect(stepperItems).toHaveLength(7);
    expect(workflowCards).toHaveLength(7);
    expect(stepper.compareDocumentPosition(cards) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    for (const title of ["Find", "Dispatch", "Accept", "Assign", "Verify", "Complete", "Approve"]) {
      const index = ["Find", "Dispatch", "Accept", "Assign", "Verify", "Complete", "Approve"].indexOf(title);
      expect(within(stepperItems[index]).getByText(title, { exact: true })).toBeTruthy();
      expect(stepperItems[index].querySelector("[data-step-dot]")?.className).toContain("bg-white");
      expect(stepperItems[index].textContent).not.toContain(`0${index + 1}`);
      expect(workflowCards[index].querySelector("h3")).toBeNull();
      expect(workflowCards[index].firstElementChild?.tagName).toBe("P");
      expect(workflowCards[index].textContent).not.toContain(`0${index + 1}`);
      expect(workflowCards[index].querySelector("p")?.className).toContain("text-white");
    }
    expect(cards.className).toContain("mt-2");
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
