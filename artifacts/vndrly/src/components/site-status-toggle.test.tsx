import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === "siteLocations.statusOption.active") return "Active";
      if (key === "siteLocations.statusOption.inactive") return "Inactive";
      return key;
    },
  }),
}));

import SiteStatusToggle from "./site-status-toggle";

describe("SiteStatusToggle", () => {
  it("calls onActiveClick when inactive and user selects Active", async () => {
    const onActiveClick = vi.fn();
    render(
      <SiteStatusToggle active={false} onActiveClick={onActiveClick} onInactiveClick={vi.fn()} />,
    );
    await userEvent.click(screen.getByTestId("site-status-active"));
    expect(onActiveClick).toHaveBeenCalledTimes(1);
  });

  it("calls onInactiveClick when active and user selects Inactive", async () => {
    const onInactiveClick = vi.fn();
    render(
      <SiteStatusToggle active onInactiveClick={onInactiveClick} onActiveClick={vi.fn()} />,
    );
    await userEvent.click(screen.getByTestId("site-status-inactive"));
    expect(onInactiveClick).toHaveBeenCalledTimes(1);
  });

  it("does not fire handlers when read-only", async () => {
    const onActiveClick = vi.fn();
    const onInactiveClick = vi.fn();
    render(
      <SiteStatusToggle
        active={false}
        readOnly
        onActiveClick={onActiveClick}
        onInactiveClick={onInactiveClick}
      />,
    );
    await userEvent.click(screen.getByTestId("site-status-active"));
    await userEvent.click(screen.getByTestId("site-status-inactive"));
    expect(onActiveClick).not.toHaveBeenCalled();
    expect(onInactiveClick).not.toHaveBeenCalled();
  });
});
