import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/lib/locales/en.json";
import es from "@/lib/locales/es.json";
import { WorkHubSearch, searchQueryPath } from "./WorkHubSearch";

const network = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: network.api }));
vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    primary: "#c46126",
    card: "#222",
    text: "white",
    mutedForeground: "#aaa",
    border: "#555",
    destructive: "red",
  }),
}));
vi.mock("@/components/TogglePillButton", () => ({
  default: ({
    children,
    accessibilityLabel,
    accessibilityState,
    onPress,
  }: any) => (
    <button
      aria-label={accessibilityLabel}
      aria-pressed={accessibilityState?.selected}
      onClick={onPress}
    >
      {children}
    </button>
  ),
}));

const i18n = createInstance();
await i18n
  .use(initReactI18next)
  .init({
    lng: "en",
    resources: { en: { translation: en }, es: { translation: es } },
    interpolation: { escapeValue: false },
  });
beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(() => {
  cleanup();
  network.api.mockReset();
});

describe("Work Hub Search", () => {
  it("focuses a short search query and associates its validation error", () => {
    render(<WorkHubSearch onOpen={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const input = screen.getByLabelText("Search Work Hub");
    expect(document.activeElement === input).toBe(true);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(
      document.getElementById(input.getAttribute("aria-describedby")!)
        ?.textContent,
    ).toBe("Enter at least two characters.");
  });
  it("renders Spanish filters, errors, results, source-limit notices, and actions", async () => {
    await i18n.changeLanguage("es");
    network.api
      .mockResolvedValueOnce({
        results: [
          {
            id: "note:one",
            subjectType: "note",
            subjectId: "one",
            title: "Bomba 3",
            destination: { module: "files-notes", itemId: "one" },
          },
        ],
        cappedSources: ["message"],
        nextCursor: "next",
      })
      .mockRejectedValue(new Error("Internal English detail"));
    render(<WorkHubSearch onOpen={vi.fn()} />);
    expect(screen.getByText("Buscar registros de Work Hub")).toBeTruthy();
    expect(screen.getByLabelText("Desde la fecha")).toBeTruthy();
    expect(screen.getByLabelText("Hasta la fecha")).toBeTruthy();
    for (const name of [
      "Mensajes",
      "Notas",
      "Reuniones",
      "Transcripciones",
      "Archivos",
      "Tareas",
      "Formularios",
      "Anuncios",
    ])
      expect(screen.getByRole("button", { name })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    expect(screen.getByRole("alert").textContent).toBe(
      "Ingrese al menos dos caracteres.",
    );
    fireEvent.change(screen.getByLabelText("Buscar en Work Hub"), {
      target: { value: "Bomba" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    expect(
      await screen.findByRole("button", { name: "Abrir Bomba 3" }),
    ).toBeTruthy();
    expect(
      screen.getByText(/Los resultados de Mensajes pueden estar limitados/),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Cargar más resultados" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Abrir Bomba 3" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Este elemento ya no está disponible.",
    );
    expect(screen.queryByText("Internal English detail")).toBeNull();
  });
  it("lets both date inputs shrink below their intrinsic width on small screens", () => {
    render(<WorkHubSearch onOpen={vi.fn()} />);
    for (const label of ["From date", "Through date"]) {
      expect(getComputedStyle(screen.getByLabelText(label)).minWidth).toBe(
        "0px",
      );
    }
  });
  it("retains allowed linked type filters through display, submission and continuation", async () => {
    network.api
      .mockResolvedValueOnce({
        results: [],
        cappedSources: [],
        nextCursor: "next",
      })
      .mockResolvedValue({ results: [], cappedSources: [] });
    render(
      <WorkHubSearch
        onOpen={vi.fn()}
        initialFilters={{ query: "pump", types: ["file", "note"] }}
      />,
    );
    expect(
      screen
        .getByRole("button", { name: "Files" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "Notes" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Load more results" }),
    );
    await waitFor(() =>
      expect(network.api).toHaveBeenLastCalledWith(
        "/api/work-hub/search?q=pump&type=file%2Cnote&cursor=next",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() =>
      expect(network.api).toHaveBeenLastCalledWith(
        "/api/work-hub/search?q=pump&type=note",
      ),
    );
  });
  it("starts with the exact filters supplied by an assistant link", () => {
    render(
      <WorkHubSearch
        onOpen={vi.fn()}
        initialFilters={{
          query: "pump",
          start: "2026-09-01",
          end: "2026-09-24",
          types: ["note"],
        }}
      />,
    );
    expect(
      (screen.getByLabelText("Search Work Hub") as HTMLInputElement).value,
    ).toBe("pump");
    expect((screen.getByLabelText("From date") as HTMLInputElement).value).toBe(
      "2026-09-01",
    );
    expect(
      (screen.getByLabelText("Through date") as HTMLInputElement).value,
    ).toBe("2026-09-24");
  });
  it("serializes the exact query, date and type filters", () => {
    expect(
      searchQueryPath({
        query: "pump & gate",
        start: "2026-09-01",
        end: "2026-09-24",
        types: ["note"],
      }),
    ).toBe(
      "/api/work-hub/search?q=pump%20%26%20gate&start=2026-09-01&end=2026-09-24&type=note",
    );
  });

  it("shows a branded search card, date and type controls, and a divider", () => {
    render(<WorkHubSearch onOpen={vi.fn()} />);
    expect(
      getComputedStyle(screen.getByLabelText("Search Work Hub")).borderTopWidth,
    ).toBe("2px");
    expect(
      getComputedStyle(screen.getByLabelText("Search Work Hub")).borderTopColor,
    ).toBe("rgb(196, 97, 38)");
    expect(screen.getByRole("button", { name: "Search" })).toBeTruthy();
    expect(screen.getByLabelText("From date")).toBeTruthy();
    expect(screen.getByLabelText("Through date")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Notes" })).toBeTruthy();
    expect(screen.getByTestId("search-results-divider")).toBeTruthy();
    expect(
      screen.getByText("Enter a search to see authorized records."),
    ).toBeTruthy();
  });

  it("submits filters, shows results and opens an exact item after a fresh access check", async () => {
    const onOpen = vi.fn();
    network.api
      .mockResolvedValueOnce({
        results: [
          {
            id: "note:7ea62dde-bf89-4ad5-b25c-5b7775023bba",
            subjectType: "note",
            subjectId: "7ea62dde-bf89-4ad5-b25c-5b7775023bba",
            title: "Pump 3",
            destination: {
              module: "files-notes",
              itemId: "7ea62dde-bf89-4ad5-b25c-5b7775023bba",
            },
          },
        ],
        cappedSources: ["message"],
      })
      .mockResolvedValueOnce({
        id: "7ea62dde-bf89-4ad5-b25c-5b7775023bba",
        name: "Pump 3",
      });
    render(<WorkHubSearch onOpen={onOpen} />);
    fireEvent.change(screen.getByLabelText("Search Work Hub"), {
      target: { value: "Pump 3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Notes" }));
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(
      await screen.findByRole("button", { name: "Open Pump 3" }),
    ).toBeTruthy();
    expect(network.api).toHaveBeenCalledWith(
      "/api/work-hub/search?q=Pump%203&type=note",
    );
    expect(screen.getByText(/Results may be limited/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Pump 3" }));
    expect(await screen.findByText("Opening Pump 3")).toBeTruthy();
    expect(network.api).toHaveBeenCalledWith(
      "/api/work-hub/search/items/note/7ea62dde-bf89-4ad5-b25c-5b7775023bba",
    );
    expect(onOpen).toHaveBeenCalledWith({
      module: "files-notes",
      itemId: "7ea62dde-bf89-4ad5-b25c-5b7775023bba",
    });
  });

  it("does not navigate after access is revoked", async () => {
    const onOpen = vi.fn();
    network.api
      .mockResolvedValueOnce({
        results: [
          {
            id: "note:7ea62dde-bf89-4ad5-b25c-5b7775023bba",
            subjectType: "note",
            subjectId: "7ea62dde-bf89-4ad5-b25c-5b7775023bba",
            title: "Pump 3",
            destination: {
              module: "files-notes",
              itemId: "7ea62dde-bf89-4ad5-b25c-5b7775023bba",
            },
          },
        ],
        cappedSources: [],
      })
      .mockRejectedValueOnce(new Error("Not found"));
    render(<WorkHubSearch onOpen={onOpen} />);
    fireEvent.change(screen.getByLabelText("Search Work Hub"), {
      target: { value: "Pump" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open Pump 3" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "This item is no longer available.",
    );
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("distinguishes loading and no results", async () => {
    let resolve!: (value: unknown) => void;
    network.api.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render(<WorkHubSearch onOpen={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search Work Hub"), {
      target: { value: "missing" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByText("Searching…")).toBeTruthy();
    resolve({ results: [], cappedSources: [] });
    expect(
      await screen.findByText("No authorized results found."),
    ).toBeTruthy();
  });

  it("continues a stable notes page using the server cursor", async () => {
    network.api
      .mockResolvedValueOnce({
        results: [
          {
            id: "note:one",
            subjectType: "note",
            subjectId: "one",
            title: "Pump One",
            destination: { module: "files-notes", itemId: "one" },
          },
        ],
        cappedSources: ["note"],
        nextCursor: "cursor-token",
      })
      .mockResolvedValueOnce({
        results: [
          {
            id: "note:two",
            subjectType: "note",
            subjectId: "two",
            title: "Pump Two",
            destination: { module: "files-notes", itemId: "two" },
          },
        ],
        cappedSources: [],
        nextCursor: null,
      });
    render(<WorkHubSearch onOpen={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search Work Hub"), {
      target: { value: "Pump" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Notes" }));
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Load more results" }),
    );
    expect(network.api).toHaveBeenLastCalledWith(
      "/api/work-hub/search?q=Pump&type=note&cursor=cursor-token",
    );
    expect(
      await screen.findByRole("button", { name: "Open Pump Two" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Pump One" })).toBeTruthy();
  });

  it("does not imply recency when an unordered channel scan is capped", async () => {
    network.api.mockResolvedValue({
      results: [],
      cappedSources: ["channel"],
      nextCursor: null,
    });
    render(<WorkHubSearch onOpen={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search Work Hub"), {
      target: { value: "handoff" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Notes" }));
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(
      await screen.findByText(/Results may be limited for Groups/),
    ).toBeTruthy();
    expect(screen.queryByText(/Recent results only/)).toBeNull();
  });
});

it("excludes retired inventory filters and ignores inventory results across pages", async () => {
  network.api
    .mockResolvedValueOnce({
      results: [
        {
          id: "asset:one",
          subjectType: "asset",
          subjectId: "one",
          title: "Excluded inventory",
          destination: { module: "files-notes", assetId: "one" },
        },
      ],
      cappedSources: [],
      nextCursor: "next",
    })
    .mockResolvedValueOnce({
      results: [
        {
          id: "asset:two",
          subjectType: "asset",
          subjectId: "two",
          title: "Also excluded",
          destination: { module: "files-notes", assetId: "two" },
        },
      ],
      cappedSources: [],
      nextCursor: null,
    });
  render(
    <WorkHubSearch
      onOpen={vi.fn()}
      initialFilters={{ query: "gate", types: ["asset", "note"] }}
    />,
  );
  expect(screen.queryByRole("button", { name: "Inventory" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Load more results" }),
  );
  await waitFor(() =>
    expect(network.api).toHaveBeenLastCalledWith(
      "/api/work-hub/search?q=gate&type=note&cursor=next",
    ),
  );
  expect(screen.queryByText("Excluded inventory")).toBeNull();
  expect(screen.queryByText("Also excluded")).toBeNull();
});
