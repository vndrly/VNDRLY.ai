import React from "react";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const dimensions = vi.hoisted(() => ({ width: 1024 }));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("@expo/vector-icons", () => ({ Feather: () => null }));
vi.mock("@/lib/notificationBadge", () => ({ useUnreadNotificationCount: () => 0 }));

vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native")>();
  return {
    ...actual,
    useWindowDimensions: () => ({ width: dimensions.width, height: 768, scale: 1, fontScale: 1 }),
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ activeMembership: { orgName: "Fallback Company", orgLogoUrl: null } }),
}));
vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({
    isOrgBranded: true,
    logoSquareUrl: "https://cdn.example.com/midcon-square.png",
    logoUrl: null,
    name: "MidCon Solutions",
  }),
}));
vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({ foreground: "black", mutedForeground: "gray" }),
}));
vi.mock("@/components/AuthedImage", () => ({
  default: ({ testID, accessibilityLabel }: { testID: string; accessibilityLabel: string }) => (
    <img data-testid={testID} aria-label={accessibilityLabel} />
  ),
}));

import BrandTitleRow from "./BrandTitleRow";

afterEach(cleanup);

describe("BrandTitleRow", () => {
  it("uses the signed-in company name when a page title is not supplied", () => {
    const screen = render(<BrandTitleRow subtitle="iOS Portal" logoTestId="company-logo" platformLogoTestId="vndrly-logo" />);

    expect(screen.getByText("MidCon Solutions")).toBeTruthy();
    expect(screen.getByText("iOS Portal")).toBeTruthy();
    expect(screen.getByTestId("company-logo").getAttribute("aria-label")).toBe("MidCon Solutions");
    expect(screen.getByTestId("vndrly-logo").getAttribute("aria-label")).toBe("VNDRLY");
  });

  it("uses the approved 20-point company name", () => {
    const source = readFileSync(__filename.replace(/\.test\.tsx$/, ".tsx"), "utf8").replace(/\r\n/g, "\n");

    expect(source).toContain('title: {\n    fontFamily: "Inter_700Bold",\n    fontSize: 20,');
  });

  it("keeps the powered-by attribution out of the main panel header", () => {
    dimensions.width = 1024;
    const wide = render(<BrandTitleRow subtitle="iOS Portal" logoTestId="company-logo" platformLogoTestId="vndrly-logo" />);
    expect(wide.queryByText("…powered by")).toBeNull();
  });

  it("supports the stacked company identity used by the iPad sidebar", () => {
    const screen = render(<BrandTitleRow stacked subtitle="MidCon Gate" logoTestId="company-logo" />);
    expect(screen.getByTestId("brand-title-stacked")).toBeTruthy();
  });
});
