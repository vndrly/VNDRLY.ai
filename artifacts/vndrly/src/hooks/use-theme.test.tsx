import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ThemeProvider, useTheme } from "./use-theme";

function Probe() {
  const { resolved } = useTheme();
  return <span>{resolved}</span>;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("permanent dark appearance", () => {
  it.each(["light", "system", "dark"])("ignores the old %s preference and device appearance", (preference) => {
    localStorage.setItem("vndrly:field:theme", preference);
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    const view = render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByText("dark")).toBeTruthy();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    view.unmount();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("also defaults to dark outside the provider", () => {
    render(<Probe />);
    expect(screen.getByText("dark")).toBeTruthy();
  });
});
