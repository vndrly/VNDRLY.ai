import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native-svg", () => ({
  Defs: ({ children }: any) => <div>{children}</div>,
  LinearGradient: ({ children }: any) => <div>{children}</div>,
  Rect: (props: any) => <div data-testid={props.testID} />,
  Stop: () => null,
  Svg: ({ children, testID }: any) => <div data-testid={testID}>{children}</div>,
  SvgXml: () => <div data-testid="halftone-map" />,
}));

import SidebarHalftoneBackground from "./SidebarHalftoneBackground";

afterEach(cleanup);

describe("SidebarHalftoneBackground", () => {
  it("feathers the header artwork into the sidebar instead of ending as a flat band", () => {
    const screen = render(<SidebarHalftoneBackground />);
    expect(screen.getByTestId("adaptive-sidebar-halftone")).toBeTruthy();
    expect(screen.getByTestId("sidebar-header-fade")).toBeTruthy();
  });
});
