import React from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18next, { type i18n as I18nInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";

import en from "@/lib/locales/en.json";
import es from "@/lib/locales/es.json";

const TestRenderer = require("react-test-renderer") as {
  act: (callback: () => void) => void;
  create: (element: React.ReactElement) => {
    root: { findByProps: (props: Record<string, unknown>) => { props: Record<string, unknown> } };
    unmount: () => void;
  };
};

vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#3a3d42",
    foreground: "#ffffff",
    card: "#1c1c1e",
    border: "#3a3a3a",
    primary: "#f59e0b",
    mutedForeground: "#a3a3a3",
    destructive: "#ef4444",
  }),
}));

import PlateStatePicker, { PLATE_STATE_PICKER_VISUALS } from "./PlateStatePicker";

let testI18n: I18nInstance;

beforeAll(async () => {
  testI18n = i18next.createInstance();
  await testI18n.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    compatibilityJSON: "v4",
    interpolation: { escapeValue: false },
    resources: {
      en: { translation: en },
      es: { translation: es },
    },
  });
});

afterEach(async () => {
  cleanup();
  await testI18n.changeLanguage("en");
});

afterAll(async () => {
  await testI18n.changeLanguage("en");
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
  return {
    props,
    ...render(
      <I18nextProvider i18n={testI18n}>
        <PlateStatePicker {...props} />
      </I18nextProvider>,
    ),
  };
}

function tap(element: HTMLElement) {
  fireEvent.pointerDown(element);
  fireEvent.pointerUp(element);
  fireEvent.click(element);
}

describe("PlateStatePicker", () => {
  it("puts preferred states first, followed by one alphabetical catalog remainder", () => {
    renderPicker();
    tap(screen.getByRole("button", { name: "Select plate state" }));

    const options = screen.getAllByRole("button", { name: /state option$/i });
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

  it("filters Texas from the accessible search field and reports the chosen code", () => {
    const { props } = renderPicker();
    tap(screen.getByRole("button", { name: "Select plate state" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search states" }), {
      target: { value: "tex" },
    });

    expect(screen.getByRole("button", { name: "Texas (TX), state option" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Oklahoma (OK), state option" })).toBeNull();
    tap(screen.getByRole("button", { name: "Texas (TX), state option" }));
    expect(props.onChange).toHaveBeenCalledWith("TX");
  });

  it("exposes the selected state, prevents disabled changes, and associates errors", () => {
    const { props } = renderPicker({ value: "TX", disabled: true, error: "Choose a valid state." });
    const trigger = screen.getByRole("button", { name: "Selected plate state: Texas (TX)" });

    expect(screen.getByRole("alert").textContent).toBe("Choose a valid state.");
    tap(trigger);
    expect(screen.queryByRole("dialog", { name: "Plate state" })).toBeNull();
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("uses the compact branded trigger and light branded menu", () => {
    expect(PLATE_STATE_PICKER_VISUALS).toEqual({
      compactHeight: 36,
      pillRadius: 999,
      borderWidth: 2,
      lightSurface: "#ffffff",
    });
    renderPicker();
    tap(screen.getByRole("button", { name: "Select plate state" }));
    expect(screen.getByRole("dialog", { name: "Plate state" })).toBeTruthy();
  });

  it("gives the open picker an accessible dialog and search control", () => {
    renderPicker();
    tap(screen.getByRole("button", { name: "Select plate state" }));

    expect(screen.getByRole("dialog", { name: "Plate state" })).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "Search states" })).toBeTruthy();
  });

  it("uses the native accessibility hint to announce its error", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let native: ReturnType<typeof TestRenderer.create>;
    TestRenderer.act(() => {
      native = TestRenderer.create(
        <I18nextProvider i18n={testI18n}>
          <PlateStatePicker
            value={null}
            onChange={vi.fn()}
            preferredStates={[]}
            error="Choose a valid state."
          />
        </I18nextProvider>,
      );
    });

    expect(native!.root.findByProps({ testID: "plate-state-picker-trigger" }).props.accessibilityHint)
      .toBe("Error: Choose a valid state.");
    native!.unmount();
    consoleError.mockRestore();
  });

  it("closes an open picker and blocks changes when it becomes disabled", () => {
    const onChange = vi.fn();
    const { rerender } = renderPicker({ onChange });
    tap(screen.getByRole("button", { name: "Select plate state" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search states" }), {
      target: { value: "tex" },
    });

    rerender(
      <I18nextProvider i18n={testI18n}>
        <PlateStatePicker
          value={null}
          onChange={onChange}
          preferredStates={["OK", "TX", "NM"]}
          disabled
        />
      </I18nextProvider>,
    );

    expect(screen.queryByRole("dialog", { name: "Plate state" })).toBeNull();
    tap(screen.getByRole("button", { name: "Select plate state" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("localizes the picker controls, grouping, and empty search state", async () => {
    await testI18n.changeLanguage("es");
    renderPicker();

    tap(screen.getByRole("button", { name: "Seleccionar estado de la placa" }));

    expect(screen.getByRole("dialog", { name: "Estado de la placa" })).toBeTruthy();
    expect(screen.getByText("Estados preferidos")).toBeTruthy();
    expect(screen.getByText("Todos los estados")).toBeTruthy();

    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar estados" }), {
      target: { value: "zzzz" },
    });
    expect(screen.getByText("No se encontraron estados.")).toBeTruthy();
  });
});
