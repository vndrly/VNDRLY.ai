import { describe, expect, it } from "vitest";

import {
  parseSafetyEventIdFromHref,
  parseSiteLocationFromHref,
  parseTicketIdFromNotificationLink,
  parseWorkHubNotificationLink,
} from "../notification-link";

describe("notification-link", () => {
  it("parses ticketId from safety notification query params", () => {
    expect(parseTicketIdFromNotificationLink("/safety/42?ticketId=10950")).toBe(10950);
  });

  it("parses site location metadata from notification links", () => {
    expect(parseSiteLocationFromHref("/safety/42?siteLocationId=7&siteName=Alpha")).toEqual({
      id: 7,
      name: "Alpha",
    });
  });

  it("parses safety event id from notification links", () => {
    expect(parseSafetyEventIdFromHref("/safety/42?siteLocationId=7")).toBe(42);
  });
  it("preserves stable internal Work Hub deep links and rejects external links", () => {
    expect(parseWorkHubNotificationLink("/work-hub/activity?notice=7")).toBe("/work-hub/activity?notice=7");
    expect(parseWorkHubNotificationLink("https://attacker.example/work-hub/activity")).toBeNull();
  });
});
