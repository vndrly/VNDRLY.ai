import { describe, expect, it } from "vitest";

import { parseTicketIdFromHref, resolveAssistantLink } from "@/lib/assistant-deep-links";
import {
  buildDeepLink,
  DEEP_LINK_SCREENS,
} from "../../../api-server/src/assistant/deep-links";

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
    "/tickets/123#comment-100",
  ])("extracts id from %s", (href) => {
    const id = href.includes("99") ? 99 : href.includes("123") ? 123 : 42;
    expect(parseTicketIdFromHref(href)).toBe(id);
  });
});

describe("resolveAssistantLink", () => {
  it("opens every URL emitted by the server deep-link registry", () => {
    for (const definition of DEEP_LINK_SCREENS) {
      if (definition.screen === "work-hub-item") continue;
      const href = buildDeepLink({
        screen: definition.screen,
        id: definition.requiresId ? 42 : undefined,
        token: definition.requiresToken ? "review-token" : undefined,
      });
      expect(typeof href, definition.screen).toBe("string");
      expect(resolveAssistantLink(href as string), `${definition.screen}: ${String(href)}`).not.toBeNull();
    }
  });

  it("opens every exact Work Hub record type emitted by the server", () => {
    const itemId = "7be22c7d-4638-4144-bb18-0d2a66996a43";
    for (const subjectType of [
      "document",
      "asset",
      "task",
      "meeting",
      "file",
      "announcement",
      "message",
      "note",
      "form",
      "transcript",
    ]) {
      const href = buildDeepLink({ screen: "work-hub-item", subjectType, itemId });
      expect(typeof href, subjectType).toBe("string");
      expect(resolveAssistantLink(href as string), `${subjectType}: ${String(href)}`).not.toBeNull();
    }
  });

  it("selects Inventory for inventory and asset module aliases", () => {
    expect(resolveAssistantLink("/work-hub/assets")).toEqual({ type: "route", path: "/work-hub/files-notes?section=inventory" });
    expect(resolveAssistantLink("vndrly-deep-link:work-hub-inventory")).toEqual({ type: "route", path: "/work-hub/files-notes?section=inventory" });
  });
  it("keeps exact Work Hub IDs and filter state in native routes", () => {
    expect(resolveAssistantLink("/work-hub/search?type=task&item=7be22c7d-4638-4144-bb18-0d2a66996a43")).toEqual({ type: "route", path: "/work-hub/search-item/task/7be22c7d-4638-4144-bb18-0d2a66996a43" });
    expect(resolveAssistantLink("/work-hub/search?q=pump&type=asset&start=2026-09-01")).toEqual({ type: "route", path: "/work-hub/search?q=pump&type=asset&start=2026-09-01" });
    expect(resolveAssistantLink("/work-hub/files-notes?assetId=7be22c7d-4638-4144-bb18-0d2a66996a43")).toEqual({ type: "route", path: "/work-hub/files-notes?section=inventory&assetId=7be22c7d-4638-4144-bb18-0d2a66996a43" });
    expect(resolveAssistantLink("/work-hub/search?type=unknown&item=abc")).toBeNull();
    expect(resolveAssistantLink("vndrly-deep-link:work-hub-nonexistent")).toBeNull();
  });
  it("opens the native Shift Notes, Profile and Gate destinations", () => {
    expect(resolveAssistantLink("/gate/shift-notes")).toEqual({ type: "route", path: "/gate/shift-notes" });
    expect(resolveAssistantLink("/field/profile")).toEqual({ type: "route", path: "/(tabs)/profile" });
    expect(resolveAssistantLink("/gate")).toEqual({ type: "route", path: "/(tabs)/gate" });
  });
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
