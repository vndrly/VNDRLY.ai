import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAssistantShareMailtoUrl } from "./notification-mailto";

describe("buildAssistantShareMailtoUrl", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      location: { origin: "http://localhost:5173" },
    });
    vi.stubEnv("BASE_URL", "/");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("prefills subject, Q&A body, and page link", () => {
    const url = buildAssistantShareMailtoUrl({
      question: "How much have we paid in Texas YTD?",
      answer: "I do not have access to tax payment breakdowns by state.",
      pagePath: "/reports",
      typeLabel: "AskV message",
    });

    expect(url.startsWith("mailto:?")).toBe(true);
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain("AskV — How much have we paid in Texas YTD?");
    expect(decoded).toContain("Question: How much have we paid in Texas YTD?");
    expect(decoded).toContain("I do not have access to tax payment breakdowns by state.");
    expect(decoded).toContain("http://localhost:5173/reports");
  });
});
