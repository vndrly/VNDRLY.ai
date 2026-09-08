import { describe, expect, it } from "vitest";
import { MARKETING_MODULES, marketingCtaHref } from "./marketing-content";

describe("commercial homepage content", () => {
  it("covers the product without endorsements or fabricated proof", () => {
    expect(MARKETING_MODULES.length).toBeGreaterThanOrEqual(10);
    expect(MARKETING_MODULES.some((item) => item.title.includes("Work Hub"))).toBe(true);
    expect(MARKETING_MODULES.every((item) => !/partner logo|trusted by|customer/i.test(`${item.title} ${item.description}`))).toBe(true);
  });

  it("uses the existing signup flow for every contextual CTA", () => {
    expect(marketingCtaHref).toBe("/signup");
    expect(MARKETING_MODULES.every((item) => item.ctaHref === marketingCtaHref)).toBe(true);
  });
});
