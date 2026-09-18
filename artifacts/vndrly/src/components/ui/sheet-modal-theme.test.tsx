import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./sheet";

vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({
    name: "MidCon Solutions",
    logoUrl: "/midcon-wide.png",
    logoSquareUrl: "/midcon-square.png",
    primary: "#13b7c7",
  }),
}));

afterEach(cleanup);

describe("SheetContent modal chrome", () => {
  it("leaves ordinary navigation sheets unchanged", () => {
    render(
      <Sheet open>
        <SheetContent data-testid="navigation-sheet">Navigation</SheetContent>
      </Sheet>,
    );

    expect(screen.getByTestId("navigation-sheet").className).toContain("bg-background");
    expect(screen.queryByTestId("app-modal-header")).toBeNull();
  });

  it("gives opted-in modal sheets the dark shell and shared header", () => {
    render(
      <Sheet open>
        <SheetContent data-testid="modal-sheet" modalChrome>
          <SheetHeader>
            <SheetTitle>Find Vendor</SheetTitle>
            <SheetDescription>Choose another vendor</SheetDescription>
          </SheetHeader>
          <div>Vendor results</div>
        </SheetContent>
      </Sheet>,
    );

    expect(screen.getByTestId("modal-sheet").className).toContain("bg-[#3a3d42]");
    const header = screen.getByTestId("app-modal-header");
    expect(header.contains(screen.getByText("Find Vendor"))).toBe(true);
    expect(header.contains(screen.getByText("Choose another vendor"))).toBe(true);
    const body = screen.getByTestId("sheet-modal-body");
    expect(body.className).toContain("bg-[#d1d5db]");
    expect(body.style.colorScheme).toBe("light");
  });
});
