import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Work Hub channel error feedback", () => {
  it("shows channel loading and creation errors next to the create form", () => {
    const source = readFileSync(
      resolve(__dirname, "../pages/work-hub.tsx"),
      "utf8",
    );

    expect(source).toContain("<Notice error={channels.error ?? create.error} />");
  });
});
