import { describe, expect, it } from "vitest";

import colors from "../constants/colors";

describe("mobile card surface", () => {
  it("uses the approved charcoal for every dark-mode card", () => {
    expect(colors.dark.card).toBe("#242426");
  });
});
