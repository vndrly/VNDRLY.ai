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

  it("presents Work Hub after trust without exposure", () => {
    render(<MarketingHome />);

    const trustLabel = screen.getByText("Trust without exposure", { exact: true });
    const workHub = screen.getByRole("region", { name: "Work Hub" });
    const gettingStarted = screen.getByText("Getting started", { exact: true });

    expect(trustLabel.compareDocumentPosition(workHub) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(workHub.compareDocumentPosition(gettingStarted) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(workHub).getByRole("heading", { name: "Keep every conversation tied to the work." })).toBeTruthy();
    expect(
      within(workHub).getByText(
        "Share durable updates, decisions, and company-wide messages using push notifications, without relying on scattered texts to coordinate work.",
      ),
    ).toBeTruthy();

    const cards = within(workHub).getAllByRole("article");
    expect(cards).toHaveLength(6);
    for (const title of [
      "Single or group chat conversations",
      "Calendars & scheduling",
      "Tasks & handoffs",
      "Forms & files",
      "Notes & announcements",
      "Meetings & role-aware collaboration",
    ]) {
      const heading = within(workHub).getByRole("heading", { name: title });
      const card = heading.closest("article");
      expect(card?.className).toContain("border-2");
      expect(card?.className).toContain("border-[var(--vndrly-amber)]");
      expect(card?.className).toContain("bg-[#2b3035]");
      expect(card?.querySelector("p")?.className).toContain("text-white");
    }
  });

  it("shows the payment and payroll roadmap as coming soon", () => {
    render(<MarketingHome />);

    const payments = screen.getByRole("region", { name: /secure direct payments/i });
    expect(payments.className).toContain("bg-[#20262b]");
    expect(payments.className).not.toContain("bg-gradient-to-br");
    expect(within(payments).getAllByText(/coming soon/i).length).toBeGreaterThan(0);
    const directPayments = within(payments).getByRole("heading", { name: "Secure direct payments" });
    const payrollReporting = within(payments).getByRole("heading", { name: "Make Payroll & IRS Reporting" });
    const invoicing = within(payments).getByRole("heading", { name: "Invoicing has never been easier" });
    expect(
      directPayments.compareDocumentPosition(payrollReporting) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      payrollReporting.compareDocumentPosition(invoicing) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      within(payments).getByText(
        "Manage mileage and hours for your employees, compatible with QuickBooks, OpenAccountant with CSV exports available if you choose.",
      ),
    ).toBeTruthy();
    expect(
      within(payments).getByText(
        "Automatic invoicing prepares your work product into a electronic invoice that stays in the same workflow native to VNDRLY with a full audit trail. Partners can verify the work product before paying Vendors",
      ),
    ).toBeTruthy();
    expect(within(payments).getByTestId("marketing-coming-soon-pill").style.height).toBe("30px");
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
    const signInLayers = signIn.querySelectorAll(":scope > div");
    expect(signInLayers[1]?.className).toContain("group-hover:opacity-100");
    expect(signInLayers[1]?.className).not.toContain("group-hover:opacity-90");
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
    const featuredSolutionsLabel = screen.getByText("Featured solutions");
    expect(featuredSolutionsLabel.style.color).toBe("white");
    expect(featuredSolutionsLabel.style.textShadow).toBe("");
    expect(featuredSolutionsLabel.style.backgroundColor).toBe("rgb(43, 48, 53)");
    expect(featuredSolutionsLabel.style.borderWidth).toBe("2px");
    expect(featuredSolutionsLabel.style.borderColor).toBe("var(--vndrly-amber)");
    expect(featuredSolutionsLabel.style.padding).toBe("6px 12px");
    expect(featuredSolutionsLabel.style.fontSize).toBe("14px");

    const connectedOperationsLabel = screen.getByText("Connected operations", { exact: true });
    expect(connectedOperationsLabel.style.color).toBe("white");
    expect(connectedOperationsLabel.style.backgroundColor).toBe("rgb(43, 48, 53)");
    expect(connectedOperationsLabel.style.borderWidth).toBe("2px");
    expect(connectedOperationsLabel.style.borderColor).toBe("var(--vndrly-amber)");
    expect(connectedOperationsLabel.style.padding).toBe("6px 12px");
    expect(connectedOperationsLabel.style.fontSize).toBe("14px");

    for (const text of ["Getting started", "Frequently asked questions"]) {
      const label = screen.getByText(text, { exact: true });
      expect(label.style.color).toBe("white");
      expect(label.style.backgroundColor).toBe("rgb(43, 48, 53)");
      expect(label.style.borderWidth).toBe("2px");
      expect(label.style.borderColor).toBe("var(--vndrly-amber)");
      expect(label.style.padding).toBe("6px 12px");
      expect(label.style.fontSize).toBe("14px");
    }
    expect(screen.getByTestId("hero-fade").className).toContain("to-[#3a3d42]");

    for (const link of screen.getAllByRole("link", { name: /get started/i })) {
      expect(link.getAttribute("data-color")).toBe("amber");
    }

    for (const title of ["Verified fit", "Earned reputation", "Faster discovery", "Security aware"]) {
      const highlightTitle = screen.getByRole("heading", { name: title });
      expect(highlightTitle.className).toContain("text-white");
      expect(highlightTitle.parentElement?.className).toContain("flex");
      expect(highlightTitle.previousElementSibling?.getAttribute("class")).toContain("text-[var(--vndrly-amber)]");
    }

    for (const description of [
      "Turn urgent field demand into a qualified opportunity without rebuilding the vendor search from scratch.",
      "Connect gate locations, shifts, arrivals, visitors, handoffs, and history in one operational record.",
    ]) {
      expect(screen.getByText(description).className).toContain("text-white");
    }
  });

  it("uses 30px conversion pills and a centered halftone-only hero", () => {
    render(<MarketingHome />);

    const primaryActions = screen.getAllByTestId("marketing-primary-cta");
    const demoActions = screen.getAllByTestId("marketing-demo-cta");
    expect(primaryActions).toHaveLength(2);
    expect(demoActions).toHaveLength(2);

    for (const action of [...primaryActions, ...demoActions]) {
      expect(action.style.height).toBe("30px");
      expect(action.style.minHeight).toBe("30px");
      expect(action.style.maxHeight).toBe("30px");
      expect(action.className).toContain("text-[13px]");
      expect(action.className).toContain("font-bold");
    }
    for (const action of primaryActions) {
      expect(action.getAttribute("data-color")).toBe("amber");
      expect(action.className).toContain("group");
      const layers = Array.from(action.children).filter((child) => child.tagName === "DIV") as HTMLElement[];
      expect(layers[0]?.className).toContain("group-hover:opacity-0");
      expect(layers[1]?.className).toContain("group-hover:opacity-100");
      expect(action.querySelector(":scope > span")?.className).toContain("font-black");
    }
    for (const action of demoActions) {
      expect(action.style.fontSize).toBe("13px");
      expect(action.style.fontWeight).toBe("700");
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

    const directoryCard = screen.getByLabelText("Verified network highlights");
    expect(directoryCard.className).toContain("bg-[#2b3035]");
    expect(directoryCard.className).toContain("border-2");
    expect(directoryCard.className).toContain("border-[#9ca3af]");

    for (const copy of [
      "Services, geography, eligibility, and current operational context.",
      "Ratings and activity signals grounded in completed work.",
      "Find qualified providers fast through our network of vendors.",
      "All transactions are audited for security 24/7",
    ]) {
      expect(screen.getByText(copy).className).toContain("text-white");
    }
  });

  it("uses a 2px VNDRLY amber outline on every card surface except the light-grey directory frame", () => {
    render(<MarketingHome />);

    const cards = screen.getAllByTestId("marketing-card");
    expect(cards).toHaveLength(31);
    for (const card of cards) {
      expect(card.className).toContain("border-2");
      if (card.getAttribute("aria-label") === "Verified network highlights") {
        expect(card.className).toContain("border-[#9ca3af]");
      } else {
        expect(card.className).toContain("border-[var(--vndrly-amber)]");
      }
    }
  });

  it("separates every major homepage section with a 2px VNDRLY amber divider", () => {
    render(<MarketingHome />);

    const dividers = screen.getAllByTestId("marketing-section-divider");
    expect(dividers).toHaveLength(9);
    for (const divider of dividers) {
      expect(divider.className).toContain("border-t-2");
      expect(divider.className).toContain("border-[var(--vndrly-amber)]");
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
      name: "From “we need this done” to an approval-ready record, ready to be paid",
    });
    expect(workflowHeading.className).toContain("text-[23px]");
    expect(workflowHeading.className).toContain("sm:text-[36px]");

    for (const card of within(screen.getByRole("list", { name: /job workflow/i })).getAllByRole("listitem")) {
      expect(card.className).toContain("border-[var(--vndrly-amber)]");
      expect(card.querySelector("h3")).toBeNull();
    }
  });

  it("matches connected operations cards to the featured solution card treatment", () => {
    render(<MarketingHome />);

    for (const title of ["Plan & dispatch", "Execute & verify", "Collaborate & hand off", "Review & report"]) {
      const heading = screen.getByRole("heading", { name: title });
      const card = heading.closest("article");
      expect(card?.className).toContain("rounded-3xl");
      expect(card?.className).toContain("border-2");
      expect(card?.className).toContain("border-[var(--vndrly-amber)]");
      expect(card?.className).toContain("bg-[#2b3035]");
      expect(heading.className).toContain("text-white");
      expect(heading.parentElement?.className).toContain("flex");
      expect(heading.previousElementSibling?.tagName).toBe("svg");
      expect(card?.querySelector("p")?.className).toContain("text-white");
    }
  });

  it("matches trust and Product Guide cards to the featured solution treatment", () => {
    render(<MarketingHome />);

    for (const label of ["Verified operational signals", "Role and organization permissions", "Reputation built through work", "No public account directory"]) {
      const card = screen.getByText(label, { exact: true }).closest('[data-testid="marketing-card"]');
      expect(card?.className).toContain("border-2");
      expect(card?.className).toContain("border-[var(--vndrly-amber)]");
      expect(card?.className).toContain("bg-[#2b3035]");
      expect(card?.className).toContain("text-white");
      expect(card?.querySelector("svg")?.getAttribute("class")).toContain("text-[var(--vndrly-amber)]");
    }

    const productGuideHeading = screen.getByRole("heading", { name: "Questions before you sign in?" });
    const productGuideCard = productGuideHeading.closest("aside");
    expect(productGuideCard?.className).toContain("border-2");
    expect(productGuideCard?.className).toContain("border-[var(--vndrly-amber)]");
    expect(productGuideCard?.className).toContain("bg-[#2b3035]");
    expect(productGuideHeading.className).toContain("text-white");
    expect(productGuideCard?.querySelector("p.leading-7")?.className).toContain("text-white");
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

      expect(card?.querySelector("p.leading-7")?.className).toContain("text-white");
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
