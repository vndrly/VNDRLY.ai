import { describe, expect, it } from "vitest";

import { parseTicketIdFromHref, resolveAssistantLink } from "@/lib/assistant-deep-links";

describe("parseTicketIdFromHref", () => {
  it.each([
    "/tickets/42",
    "/ticket/42",
    "VNDRLY-deep-link:ticket-detail/42",
    "VNDRLY-deep-link:ticket-detail:42",
    "VNDRLY-deep-link:ticket-detail?id=42",
    "VNDRLY-deep-link:tickets/42",
    "https://vndrly.ai/tickets/99",
    "https://vndrly.ai/ticket/99",
  ])("extracts id from %s", (href) => {
    const id = href.includes("99") ? 99 : 42;
    expect(parseTicketIdFromHref(href)).toBe(id);
  });
});

describe("resolveAssistantLink", () => {
  it("maps VNDRLY-deep-link screen slugs to web URLs when no mobile screen exists", () => {
    expect(resolveAssistantLink("VNDRLY-deep-link:partner-catalog")).toEqual({
      type: "browser",
      url: "https://vndrly.ai/partner-catalog",
    });
  });

  it("maps all ticket href shapes to the native ticket screen", () => {
    const expected = { type: "route" as const, path: "/ticket/42" };
    expect(resolveAssistantLink("VNDRLY-deep-link:ticket-detail/42")).toEqual(expected);
    expect(resolveAssistantLink("VNDRLY-deep-link:ticket-detail:42")).toEqual(expected);
    expect(resolveAssistantLink("VNDRLY-deep-link:ticket-detail?id=42")).toEqual(expected);
    expect(resolveAssistantLink("/tickets/42")).toEqual(expected);
    expect(resolveAssistantLink("/ticket/42")).toEqual(expected);
    expect(resolveAssistantLink("https://vndrly.ai/tickets/42")).toEqual(expected);
  });

  it("maps ticket list deep links to history tab", () => {
    expect(resolveAssistantLink("VNDRLY-deep-link:tickets")).toEqual({
      type: "route",
      path: "/history",
    });
    expect(resolveAssistantLink("/tickets")).toEqual({
      type: "route",
      path: "/history",
    });
  });

  it("maps in-app web paths to mobile routes", () => {
    expect(resolveAssistantLink("/notifications")).toEqual({
      type: "route",
      path: "/notifications",
    });
    expect(resolveAssistantLink("/vendor-catalog")).toEqual({
      type: "route",
      path: "/services",
    });
  });

  it("maps absolute vndrly.ai ticket URLs to mobile routes", () => {
    expect(resolveAssistantLink("https://vndrly.ai/tickets/99")).toEqual({
      type: "route",
      path: "/ticket/99",
    });
  });
});
