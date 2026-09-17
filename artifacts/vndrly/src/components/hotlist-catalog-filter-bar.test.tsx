import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import HotlistCatalogFilterBar from "./hotlist-catalog-filter-bar";

describe("HotlistCatalogFilterBar", () => {
  it("uses the branded pill treatment and preserves the hidden count toggle", async () => {
    const showAll = vi.fn();
    render(
      <HotlistCatalogFilterBar
        includeAll={false}
        filteredCount={17}
        onShowAll={showAll}
        onFilter={() => undefined}
      />,
    );

    expect(screen.getByTestId("pill-catalog-filtered").getAttribute("data-color")).toBe("brand");
    expect(screen.getByText("17 hidden")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(showAll).toHaveBeenCalledOnce();
  });
});
