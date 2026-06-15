import { describe, expect, it } from "vitest";

import {
  assistantInlinePlainText,
  normalizeAssistantMarkdownInput,
  parseAssistantInlineSegments,
  unwrapBoldMarkdownLinks,
} from "@/lib/assistant-markdown-inline";

describe("parseAssistantInlineSegments", () => {
  it("parses partner catalog deep link from screenshot markdown", () => {
    const raw =
      "Try this: [Open Partner Catalog →](VNDRLY-deep-link:partner catalog)";
    const segments = parseAssistantInlineSegments(raw);
    expect(segments).toContainEqual({
      kind: "link",
      label: "Open Partner Catalog →",
      href: "VNDRLY-deep-link:partner catalog",
    });
    expect(assistantInlinePlainText(segments)).not.toContain("[Open");
    expect(assistantInlinePlainText(segments)).not.toContain("](VNDRLY");
  });

  it("parses ticket path markdown", () => {
    const segments = parseAssistantInlineSegments(
      "Here is [Open ticket #42](/tickets/42) for you.",
    );
    expect(segments).toContainEqual({
      kind: "link",
      label: "Open ticket #42",
      href: "/tickets/42",
    });
  });

  it("unwraps bold-wrapped markdown links instead of leaving raw brackets", () => {
    const wrapped =
      "**[Open Partner Catalog →](VNDRLY-deep-link:partner-catalog)**";
    expect(unwrapBoldMarkdownLinks(wrapped)).toBe(
      "[Open Partner Catalog →](VNDRLY-deep-link:partner-catalog)",
    );
    const segments = parseAssistantInlineSegments(wrapped);
    expect(segments).toContainEqual({
      kind: "link",
      label: "Open Partner Catalog →",
      href: "VNDRLY-deep-link:partner-catalog",
    });
    expect(assistantInlinePlainText(segments)).toBe("Open Partner Catalog →");
  });

  it("linkifies bare deep-link schemes in plain text", () => {
    const segments = parseAssistantInlineSegments(
      "Tap VNDRLY-deep-link:ticket-detail/42 to open it.",
    );
    expect(segments.some((s) => s.kind === "link" && s.href.includes("42"))).toBe(
      true,
    );
  });

  it("normalizes unicode brackets and collapsed whitespace before parens", () => {
    const normalized = normalizeAssistantMarkdownInput(
      "\uFF3BOpen\uFF3D\uFF08VNDRLY-deep-link:tickets\uFF09",
    );
    expect(normalized).toBe("[Open](VNDRLY-deep-link:tickets)");
  });
});
