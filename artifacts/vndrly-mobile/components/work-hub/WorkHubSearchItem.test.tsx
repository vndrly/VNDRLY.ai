import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/lib/locales/en.json";
import es from "@/lib/locales/es.json";
import { WorkHubSearchItem } from "./WorkHubSearchItem";

const network = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: network.api }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ primary: "orange", card: "#222", text: "white", mutedForeground: "gray", destructive: "red" }) }));
afterEach(() => { cleanup(); network.api.mockReset(); });
beforeEach(async () => { await i18next.use(initReactI18next).init({ lng: "en", resources: { en: { translation: en }, es: { translation: es } } }); });

describe("exact Work Hub search item", () => {
  it("localizes Spanish type, status, and revoked-access errors without translating authored content", async () => {
    await i18next.changeLanguage("es");
    network.api.mockResolvedValue({ id: "7be22c7d-4638-4144-bb18-0d2a66996a43", subjectType: "task", title: "Customer's English title", status: "open" });
    const view = render(<WorkHubSearchItem subjectType="task" itemId="7be22c7d-4638-4144-bb18-0d2a66996a43" />);
    await screen.findByText("Customer's English title");
    expect(screen.getByText("Tareas")).toBeTruthy(); expect(screen.getByText("Abierto")).toBeTruthy();
    network.api.mockRejectedValue(Object.assign(new Error("Private English detail"), { status: 403 }));
    view.rerender(<WorkHubSearchItem subjectType="note" itemId="7be22c7d-4638-4144-bb18-0d2a66996a43" />);
    expect((await screen.findByRole("alert")).textContent).toBe("Este elemento ya no está disponible.");
    expect(screen.queryByText("Private English detail")).toBeNull();
  });
  it("reads managed documents through their authorized library endpoint", async () => {
    network.api.mockResolvedValue({ id: "7be22c7d-4638-4144-bb18-0d2a66996a43", subjectType: "document", title: "Managed document", status: "active" });
    render(<WorkHubSearchItem subjectType="document" itemId="7be22c7d-4638-4144-bb18-0d2a66996a43" />);
    expect(await screen.findByText("Managed document")).toBeTruthy();
    expect(network.api).toHaveBeenCalledWith("/api/work-hub/file-library/7be22c7d-4638-4144-bb18-0d2a66996a43");
  });
  it("loads the exact item and displays its current details", async () => {
    network.api.mockResolvedValue({ id: "7be22c7d-4638-4144-bb18-0d2a66996a43", subjectType: "task", title: "Handoff", body: "Verify crew", status: "open" });
    render(<WorkHubSearchItem subjectType="task" itemId="7be22c7d-4638-4144-bb18-0d2a66996a43" />);
    expect(await screen.findByText("Handoff")).toBeTruthy();
    expect(screen.getByText("Verify crew")).toBeTruthy();
    expect(network.api).toHaveBeenCalledWith("/api/work-hub/search/items/task/7be22c7d-4638-4144-bb18-0d2a66996a43");
  });

  it("does not show stale details when the open is denied", async () => {
    network.api.mockRejectedValue(new Error("Item not found"));
    render(<WorkHubSearchItem subjectType="task" itemId="7be22c7d-4638-4144-bb18-0d2a66996a43" />);
    expect((await screen.findByRole("alert")).textContent).toBe("This item is no longer available.");
    expect(screen.queryByText("Handoff")).toBeNull();
  });
});
