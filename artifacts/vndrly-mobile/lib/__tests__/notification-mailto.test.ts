import { describe, expect, it, vi } from "vitest";

import { buildNotificationMailtoUrl } from "../notification-mailto";

vi.mock("@/lib/api", () => ({
  getApiBase: () => "https://vndrly.ai",
}));

describe("buildNotificationMailtoUrl", () => {
  it("includes web and mobile deep links for ticket notifications", () => {
    const url = buildNotificationMailtoUrl({
      title: "New note on a tracking number",
      body: "A new note was added on tracking #10950.",
      link: "/tickets/10950",
      createdAt: "2026-06-18T12:00:00.000Z",
      typeLabel: "New note",
    });

    expect(url.startsWith("mailto:?")).toBe(true);
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain("New note on a tracking number");
    expect(decoded).toContain("https://vndrly.ai/tickets/10950");
    expect(decoded).toContain("vndrly-deep-link:ticket-detail/10950");
  });
});
