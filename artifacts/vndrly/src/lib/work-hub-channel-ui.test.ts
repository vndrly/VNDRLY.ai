import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Work Hub channel error feedback", () => {
  it("shows channel loading and creation errors next to the create form", () => {
    const source = readFileSync(
      resolve(__dirname, "../pages/work-hub.tsx"),
      "utf8",
    );

    expect(source).toContain(
      "<Notice error={channels.error ?? create.error} />",
    );
  });

  it("keeps the empty channel state in one card and requires confirmation before deleting", () => {
    const source = readFileSync(
      resolve(__dirname, "../pages/work-hub.tsx"),
      "utf8",
    );

    expect(source).not.toContain(
      "Create or select a channel to open its conversation.",
    );
    expect(source).toContain('aria-label="Delete channel"');
    expect(source).toContain("Delete this channel?");
    expect(source).toContain("workHubRequest(`/channels/${active}`");
    expect(source).toContain("const active = selected;");
  });

  it("uses the approved full-width calendar, equal creation cards, and compact branded file chooser", () => {
    const source = readFileSync(
      resolve(__dirname, "../pages/work-hub.tsx"),
      "utf8",
    );

    const createCardsSource = readFileSync(
      resolve(__dirname, "../components/work-hub/calendar-create-cards.tsx"),
      "utf8",
    );

    expect(source).toContain('data-testid="work-hub-calendar-layout"');
    expect(source).not.toContain("lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]");
    expect(source).toContain("<CalendarCreateCards owner={owner} />");
    expect(createCardsSource).toContain("lg:grid-cols-2");
    expect(source).toContain('data-testid="work-hub-file-input"');
    expect(source).toContain("Choose file");
  });
});
