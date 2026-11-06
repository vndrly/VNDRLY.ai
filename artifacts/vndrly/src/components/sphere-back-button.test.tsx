import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import SphereBackButton from "./sphere-back-button";

describe("SphereBackButton", () => {
  it("grows on hover without lifting", () => {
    render(
      <button type="button" className="group" aria-label="Back">
        <SphereBackButton />
      </button>,
    );

    const chrome = screen.getByTestId("sphere-back-circle");
    expect(chrome.className).toContain("group-hover:scale-110");
    expect(chrome.className).not.toContain("translate-y");
  });
});
