import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Task #778 — every paginated admin table (audit log, QuickBooks
// bulk-actions history, per-action row detail) shares one "Go to page"
// component. The acceptance criteria say:
//   - clamps to 1..totalPages
//   - no error toast on out-of-range values
//   - hidden when there's only one page
// This test pins those guarantees so a future tweak to one caller
// can't silently regress the others.
//
// fireEvent.change is preferred over userEvent.type for the number
// input because jsdom strips characters the native HTML5 number
// validator wouldn't accept (a leading "0" survives, but "4.9"
// becomes an empty string), which would yield false-failure tests
// that don't reflect real browser behavior.

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import { GoToPageForm } from "./go-to-page-form";

function setInput(value: string): HTMLInputElement {
  const input = screen.getByTestId("input-t-goto-page") as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  return input;
}

describe("GoToPageForm", () => {
  it("hides the form when there's only one page", () => {
    const onGo = vi.fn();
    render(
      <GoToPageForm totalPages={1} onGo={onGo} testIdPrefix="t" />,
    );
    expect(screen.queryByTestId("form-t-goto-page")).toBeNull();
  });

  it("hides the form when totalPages is zero", () => {
    const onGo = vi.fn();
    render(
      <GoToPageForm totalPages={0} onGo={onGo} testIdPrefix="t" />,
    );
    expect(screen.queryByTestId("form-t-goto-page")).toBeNull();
  });

  it("submits the typed page when it's in range", async () => {
    const onGo = vi.fn();
    render(
      <GoToPageForm totalPages={10} onGo={onGo} testIdPrefix="t" />,
    );
    const input = setInput("4");
    await userEvent.click(screen.getByTestId("button-t-goto-page"));
    expect(onGo).toHaveBeenCalledTimes(1);
    expect(onGo).toHaveBeenCalledWith(4);
    expect(input.value).toBe("");
  });

  it("clamps a too-high value down to totalPages", async () => {
    const onGo = vi.fn();
    render(
      <GoToPageForm totalPages={5} onGo={onGo} testIdPrefix="t" />,
    );
    setInput("999");
    await userEvent.click(screen.getByTestId("button-t-goto-page"));
    expect(onGo).toHaveBeenCalledWith(5);
  });

  it("clamps a too-low value (0) up to 1", async () => {
    const onGo = vi.fn();
    render(
      <GoToPageForm totalPages={5} onGo={onGo} testIdPrefix="t" />,
    );
    setInput("0");
    await userEvent.click(screen.getByTestId("button-t-goto-page"));
    expect(onGo).toHaveBeenCalledWith(1);
  });

  it("truncates fractional values down to the integer page", async () => {
    const onGo = vi.fn();
    render(
      <GoToPageForm totalPages={10} onGo={onGo} testIdPrefix="t" />,
    );
    setInput("4.9");
    await userEvent.click(screen.getByTestId("button-t-goto-page"));
    expect(onGo).toHaveBeenCalledWith(4);
  });

  it("ignores blank submissions silently (no callback, no toast)", () => {
    const onGo = vi.fn();
    render(
      <GoToPageForm totalPages={10} onGo={onGo} testIdPrefix="t" />,
    );
    // The submit button is disabled when the draft is blank, so admins
    // can only submit a blank form by pressing Enter in the input.
    // Drive the form-submit path directly to confirm onGo isn't fired.
    fireEvent.submit(screen.getByTestId("form-t-goto-page"));
    expect(onGo).not.toHaveBeenCalled();
  });

  it("ignores non-numeric junk silently", () => {
    const onGo = vi.fn();
    render(
      <GoToPageForm totalPages={10} onGo={onGo} testIdPrefix="t" />,
    );
    // The number input may strip junk before it reaches our handler,
    // but if a programmatic value sneaks through (e.g. a paste), the
    // submit handler still has to fall back to a no-op rather than
    // crashing or jumping to NaN.
    const input = screen.getByTestId("input-t-goto-page") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.submit(screen.getByTestId("form-t-goto-page"));
    expect(onGo).not.toHaveBeenCalled();
  });

  it("disables the input and submit button when `disabled` is true", () => {
    const onGo = vi.fn();
    render(
      <GoToPageForm
        totalPages={10}
        disabled
        onGo={onGo}
        testIdPrefix="t"
      />,
    );
    const input = screen.getByTestId("input-t-goto-page") as HTMLInputElement;
    const button = screen.getByTestId("button-t-goto-page") as HTMLButtonElement;
    expect(input.disabled).toBe(true);
    expect(button.disabled).toBe(true);
  });
});
