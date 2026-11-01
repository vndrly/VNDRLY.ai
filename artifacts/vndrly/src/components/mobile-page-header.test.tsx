import { useRef, useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ back: vi.fn(), navigate: vi.fn() }));
vi.mock("wouter", () => ({ useLocation: () => ["/gate/map", mocks.navigate] }));
vi.mock("@/lib/in-app-navigation", () => ({ navigateBackInApp: mocks.back }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options: any) => options?.defaultValue ?? key,
  }),
}));
import { MobilePageHeader } from "./mobile-page-header";
import PageBackButton from "./page-back-button";
function Page({
  title = "Dashboard",
  withBack = true,
}: {
  title?: string;
  withBack?: boolean;
}) {
  const ref = useRef<HTMLElement>(null),
    [open, setOpen] = useState(false);
  return (
    <main ref={ref}>
      <MobilePageHeader
        contentRef={ref}
        fallbackTitle="VNDRLY"
        sidebarOpen={open}
        onToggleMenu={() => setOpen((value) => !value)}
      />
      <header data-testid="original-header">
        {withBack && <PageBackButton fallbackHref="/gate" />}
        <div>
          <h1>{title}</h1>
          <p>Original subtitle</p>
        </div>
        <button>Export</button>
      </header>
      <section role="dialog">
        <h1>Dialog title</h1>
      </section>
    </main>
  );
}
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("puts the menu immediately before the original back control and retains the page heading", () => {
  render(<Page />);
  const menu = screen.getByRole("button", { name: "VNDRLY Menu" });
  const back = screen.getByRole("button", { name: "Back" });
  expect(menu.closest("[data-condensed-navigation]")?.nextElementSibling).toBe(
    back,
  );
  expect(screen.getAllByRole("heading", { name: "Dashboard" })).toHaveLength(1);
  expect(screen.getByText("Original subtitle")).toBeTruthy();
  expect(
    menu.querySelector('[data-testid="sphere-button-overlay"] svg'),
  ).toBeTruthy();
  expect(menu.querySelectorAll("img")).toHaveLength(1);
  fireEvent.click(menu);
  expect(menu.getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(menu);
  expect(menu.getAttribute("aria-expanded")).toBe("false");
  expect(mocks.back).not.toHaveBeenCalled();
  fireEvent.click(back);
  expect(mocks.back).toHaveBeenCalledWith(mocks.navigate, "/gate");
});
it("keeps actions and follows changing page titles without changing dialog headings", async () => {
  const view = render(<Page />);
  view.rerender(<Page title="Gate Log" />);
  await waitFor(() =>
    expect(screen.getByRole("heading", { name: "Gate Log" })).toBeTruthy(),
  );
  expect(screen.getByRole("button", { name: "Export" })).toBeTruthy();
  expect(
    screen
      .getByRole("heading", { name: "Dialog title" })
      .hasAttribute("data-condensed-source-title"),
  ).toBe(false);
  expect(screen.getAllByRole("button", { name: "VNDRLY Menu" })).toHaveLength(
    1,
  );
});
it("supplies menu and back controls when a page has no back button", () => {
  render(<Page withBack={false} />);
  const nav = screen.getByLabelText("Page navigation");
  expect(nav.textContent).toContain("Dashboard");
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(mocks.back).toHaveBeenCalledWith(mocks.navigate, "/");
  expect(screen.getByRole("button", { name: "Export" })).toBeTruthy();
});
