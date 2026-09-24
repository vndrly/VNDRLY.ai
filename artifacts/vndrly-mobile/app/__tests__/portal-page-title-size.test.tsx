import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const titleSources = [
  "components/GateChangeOver.tsx",
  "components/WorkHubPageTitle.tsx",
  "app/(tabs)/gate.tsx",
  "app/(tabs)/askv.tsx",
  "components/GateHistory.tsx",
  "app/(tabs)/profile.tsx",
  "components/PortalPageHeader.tsx",
];

describe("iOS portal page titles", () => {
  it.each(titleSources)("uses the approved 20-point bold title in %s", (sourcePath) => {
    const source = readFileSync(resolve(__dirname, "../..", sourcePath), "utf8");

    expect(source).toContain("fontSize: 20");
    expect(source).not.toContain("fontSize: 26");
  });
});
