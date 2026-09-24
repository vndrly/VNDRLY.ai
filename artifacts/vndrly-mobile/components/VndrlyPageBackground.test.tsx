import React from "react";
import { Text } from "react-native";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const dimensions = vi.hoisted(() => ({ width: 390 }));

vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native")>();
  return {
    ...actual,
    useWindowDimensions: () => ({ width: dimensions.width, height: 844, scale: 1, fontScale: 1 }),
  };
});

import VndrlyPageBackground from "./VndrlyPageBackground";

afterEach(cleanup);

describe("VndrlyPageBackground", () => {
  it("keeps the halftone on phones and removes it from the iPad main panel", () => {
    dimensions.width = 390;
    const phone = render(<VndrlyPageBackground><Text>Content</Text></VndrlyPageBackground>);
    expect(phone.getByTestId("vndrly-page-halftone")).toBeTruthy();
    phone.unmount();

    dimensions.width = 1024;
    const ipad = render(<VndrlyPageBackground><Text>Content</Text></VndrlyPageBackground>);
    expect(ipad.queryByTestId("vndrly-page-halftone")).toBeNull();
  });
});
