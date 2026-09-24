import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ text: "#fff" }) }));
vi.mock("expo-router", () => ({ router: { back: vi.fn(), canGoBack: () => true, replace: vi.fn() } }));
vi.mock("@/components/AskVVoiceIndicator", () => ({ default: ({ inline }: { inline?: boolean }) => <div data-inline={String(Boolean(inline))}>AskV</div> }));
vi.mock("@/components/BrandTitleRow", () => ({ default: ({ subtitle }: { subtitle: string }) => <div>Company {subtitle} VNDRLY</div> }));
vi.mock("@/components/SphereBackButton", () => ({ default: ({ onPress }: { onPress: () => void }) => <button onClick={onPress}>Back</button> }));

import WorkHubPageTitle from "./WorkHubPageTitle";

afterEach(cleanup);

describe("WorkHubPageTitle", () => {
  it("keeps AskV inline with a dashboard-sized page title", () => {
    render(<WorkHubPageTitle title="Activity" />);
    expect(screen.getByRole("heading", { name: "Activity" }).getAttribute("style")).toContain("font-size: 20px");
    expect(screen.getByText("AskV").getAttribute("data-inline")).toBe("true");
    expect(screen.getByText("Company iOS Portal VNDRLY")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
  });
});
