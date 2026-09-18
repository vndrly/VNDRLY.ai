import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import i18n from "@/lib/i18n";

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: vi.fn(),
});

import { PlateStatePicker } from "./plate-state-picker";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

function renderPicker(
  overrides: Partial<React.ComponentProps<typeof PlateStatePicker>> = {},
) {
  const props: React.ComponentProps<typeof PlateStatePicker> = {
    value: null,
    onChange: vi.fn(),
    preferredStates: ["OK", "TX", "NM"],
    ...overrides,
  };
  return { props, ...render(<PlateStatePicker {...props} />) };
}

describe("PlateStatePicker", () => {
  it("puts preferred states first, followed by one alphabetical catalog remainder", async () => {
    const user = userEvent.setup();
    renderPicker();
    expect(screen.getByTestId("plate-state-picker-trigger")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Select plate state" }));

    const options = screen.getAllByRole("option");
    const labels = options.map((option) => option.textContent);
    expect(labels.slice(0, 3)).toEqual([
      "Oklahoma (OK)",
      "Texas (TX)",
      "New Mexico (NM)",
    ]);
    expect(labels.slice(3, 7)).toEqual([
      "Alabama (AL)",
      "Alaska (AK)",
      "Arizona (AZ)",
      "Arkansas (AR)",
    ]);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toContain("District of Columbia (DC)");
    expect(screen.getByText("Preferred states")).toBeTruthy();
    expect(screen.getByText("All states")).toBeTruthy();
  });

  it("filters Texas from the accessible search field and reports the chosen code", async () => {
    const user = userEvent.setup();
    const { props } = renderPicker();
    await user.click(screen.getByRole("button", { name: "Select plate state" }));
    await user.type(screen.getByRole("combobox", { name: "Search states" }), "tex");

    await user.click(screen.getByRole("option", { name: "Texas (TX)" }));
    expect(props.onChange).toHaveBeenCalledWith("TX");
    expect(screen.queryByRole("option", { name: "Oklahoma (OK)" })).toBeNull();
  });

  it("exposes the selected state, prevents disabled changes, and associates errors", async () => {
    const user = userEvent.setup();
    const { props } = renderPicker({ value: "TX", disabled: true, error: "Choose a valid state." });
    const trigger = screen.getByRole("button", { name: "Selected plate state: Texas (TX)" });

    const error = screen.getByRole("alert");
    expect(trigger.getAttribute("aria-describedby")).toBe(error.id);
    expect(error.textContent).toBe("Choose a valid state.");
    await user.click(trigger);
    expect(screen.queryByRole("dialog", { name: "Plate state" })).toBeNull();
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("gives the open picker an accessible dialog and search control", async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.click(screen.getByRole("button", { name: "Select plate state" }));

    expect(screen.getByRole("dialog", { name: "Plate state" })).toBeTruthy();
    const trigger = screen.getByTestId("plate-state-picker-trigger");
    expect(trigger.className).toContain("h-9");
    expect(trigger.className).toContain("rounded-full");
    expect(trigger.className).toContain("border-2");
    expect(trigger.className).toContain("border-[color:var(--brand-primary)]");
    const dialog = screen.getByRole("dialog", { name: "Plate state" });
    expect(dialog.className).toContain("bg-white");
    expect(dialog.className).toContain("border-[color:var(--brand-primary)]");
    const search = screen.getByRole("combobox", { name: "Search states" });
    expect(search.className).toContain("text-popover-foreground");
    expect(search.className).toContain("placeholder:text-popover-foreground/60");

    for (const option of screen.getAllByRole("option")) {
      expect(option.className).toContain("text-popover-foreground");
      expect(option.className).toContain("aria-selected:bg-[var(--brand-primary)]");
      expect(option.className).toContain("data-[selected=true]:bg-[var(--brand-primary)]");
    }
  });

  it("selects the highlighted command option with Arrow Down and Enter", async () => {
    const user = userEvent.setup();
    const { props } = renderPicker();
    await user.click(screen.getByRole("button", { name: "Select plate state" }));

    const search = screen.getByRole("combobox", { name: "Search states" });
    await user.click(search);
    await user.keyboard("{ArrowDown}{Enter}");

    expect(props.onChange).toHaveBeenCalledWith("TX");
  });

  it("closes an open picker and blocks changes when it becomes disabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = renderPicker({ onChange });
    await user.click(screen.getByRole("button", { name: "Select plate state" }));
    await user.type(screen.getByRole("combobox", { name: "Search states" }), "tex");

    rerender(
      <PlateStatePicker
        value={null}
        onChange={onChange}
        preferredStates={["OK", "TX", "NM"]}
        disabled
      />,
    );

    expect(screen.queryByRole("dialog", { name: "Plate state" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Select plate state" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("localizes the picker controls, grouping, and empty search state", async () => {
    await i18n.changeLanguage("es");
    const user = userEvent.setup();
    renderPicker();

    await user.click(
      screen.getByRole("button", { name: "Seleccionar estado de la placa" }),
    );

    expect(screen.getByRole("dialog", { name: "Estado de la placa" })).toBeTruthy();
    expect(screen.getByText("Estados preferidos")).toBeTruthy();
    expect(screen.getByText("Todos los estados")).toBeTruthy();

    const search = screen.getByRole("combobox", { name: "Buscar estados" });
    await user.type(search, "zzzz");
    expect(screen.getByText("No se encontraron estados.")).toBeTruthy();
  });
});
