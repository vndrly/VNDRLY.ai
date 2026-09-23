import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
});
