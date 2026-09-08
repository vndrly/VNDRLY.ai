import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import CountBadgePill from "./count-badge-pill";
import { PILL_IDLE } from "@/lib/pill-palette-assets";

vi.mock("@/components/png-pill-chrome", () => ({
  PillColorLayer: ({ src }: { src: string }) => <img alt="Pill color" src={src} />,
}));
afterEach(cleanup);

it("uses the brand image for nonzero counts and gray for zero", () => {
  const { rerender } = render(<CountBadgePill color="blue" activeSrc="/brand-green.png" rest={false}>3</CountBadgePill>);
  expect(screen.getByAltText("Pill color").getAttribute("src")).toBe("/brand-green.png");
  rerender(<CountBadgePill color="blue" activeSrc="/brand-green.png" rest>0</CountBadgePill>);
  expect(screen.getByAltText("Pill color").getAttribute("src")).toBe(PILL_IDLE);
});
