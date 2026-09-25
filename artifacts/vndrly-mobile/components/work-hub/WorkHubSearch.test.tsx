import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkHubSearch, searchQueryPath } from "./WorkHubSearch";

const network = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: network.api }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ primary: "#c46126", card: "#222", text: "white", mutedForeground: "#aaa", border: "#555", destructive: "red" }) }));
vi.mock("@/components/TogglePillButton", () => ({ default: ({ children, accessibilityLabel, accessibilityState, onPress }: any) => <button aria-label={accessibilityLabel} aria-pressed={accessibilityState?.selected} onClick={onPress}>{children}</button> }));

afterEach(() => { cleanup(); network.api.mockReset(); });

describe("Work Hub Search", () => {
  it("retains all linked type filters through display, submission and continuation", async () => {
    network.api.mockResolvedValueOnce({ results: [], cappedSources: [], nextCursor: "next" }).mockResolvedValue({ results: [], cappedSources: [] });
    render(<WorkHubSearch onOpen={vi.fn()} initialFilters={{ query: "pump", types: ["asset", "note"] }} />);
    expect(screen.getByRole("button", { name: "Inventory" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Notes" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(await screen.findByRole("button", { name: "Load more inventory results" }));
    await waitFor(() => expect(network.api).toHaveBeenLastCalledWith("/api/work-hub/search?q=pump&type=asset%2Cnote&cursor=next"));
    fireEvent.click(screen.getByRole("button", { name: "Inventory" }));
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(network.api).toHaveBeenLastCalledWith("/api/work-hub/search?q=pump&type=note"));
  });
  it("starts with the exact filters supplied by an assistant link", () => {
    render(<WorkHubSearch onOpen={vi.fn()} initialFilters={{ query: "pump", start: "2026-09-01", end: "2026-09-24", types: ["asset"] }} />);
    expect((screen.getByLabelText("Search Work Hub") as HTMLInputElement).value).toBe("pump");
    expect((screen.getByLabelText("From date") as HTMLInputElement).value).toBe("2026-09-01");
    expect((screen.getByLabelText("Through date") as HTMLInputElement).value).toBe("2026-09-24");
  });
  it("serializes the exact query, date and type filters", () => {
    expect(searchQueryPath({ query: "pump & gate", start: "2026-09-01", end: "2026-09-24", types: ["asset"] }))
      .toBe("/api/work-hub/search?q=pump%20%26%20gate&start=2026-09-01&end=2026-09-24&type=asset");
  });

  it("shows a branded search card, date and type controls, and a divider", () => {
    render(<WorkHubSearch onOpen={vi.fn()} />);
    expect(getComputedStyle(screen.getByLabelText("Search Work Hub")).borderTopWidth).toBe("2px");
    expect(getComputedStyle(screen.getByLabelText("Search Work Hub")).borderTopColor).toBe("rgb(196, 97, 38)");
    expect(screen.getByRole("button", { name: "Search" })).toBeTruthy();
    expect(screen.getByLabelText("From date")).toBeTruthy();
    expect(screen.getByLabelText("Through date")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Inventory" })).toBeTruthy();
    expect(screen.getByTestId("search-results-divider")).toBeTruthy();
    expect(screen.getByText("Enter a search to see authorized records.")).toBeTruthy();
  });

  it("submits filters, shows results and opens an exact item after a fresh access check", async () => {
    const onOpen = vi.fn();
    network.api.mockResolvedValueOnce({ results: [{ id: "asset:7ea62dde-bf89-4ad5-b25c-5b7775023bba", subjectType: "asset", subjectId: "7ea62dde-bf89-4ad5-b25c-5b7775023bba", title: "Pump 3", destination: { module: "files-notes", section: "inventory", assetId: "7ea62dde-bf89-4ad5-b25c-5b7775023bba" } }], cappedSources: ["message"] })
      .mockResolvedValueOnce({ id: "7ea62dde-bf89-4ad5-b25c-5b7775023bba", name: "Pump 3" });
    render(<WorkHubSearch onOpen={onOpen} />);
    fireEvent.change(screen.getByLabelText("Search Work Hub"), { target: { value: "Pump 3" } });
    fireEvent.click(screen.getByRole("button", { name: "Inventory" }));
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByRole("button", { name: "Open Pump 3" })).toBeTruthy();
    expect(network.api).toHaveBeenCalledWith("/api/work-hub/search?q=Pump%203&type=asset");
    expect(screen.getByText(/Results may be limited/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Pump 3" }));
    expect(await screen.findByText("Opening Pump 3")).toBeTruthy();
    expect(network.api).toHaveBeenCalledWith("/api/implementation-a/assets/7ea62dde-bf89-4ad5-b25c-5b7775023bba");
    expect(onOpen).toHaveBeenCalledWith({ module: "files-notes", section: "inventory", assetId: "7ea62dde-bf89-4ad5-b25c-5b7775023bba" });
  });

  it("does not navigate after access is revoked", async () => {
    const onOpen = vi.fn();
    network.api.mockResolvedValueOnce({ results: [{ id: "asset:7ea62dde-bf89-4ad5-b25c-5b7775023bba", subjectType: "asset", subjectId: "7ea62dde-bf89-4ad5-b25c-5b7775023bba", title: "Pump 3", destination: { module: "files-notes", section: "inventory", assetId: "7ea62dde-bf89-4ad5-b25c-5b7775023bba" } }], cappedSources: [] })
      .mockRejectedValueOnce(new Error("Not found"));
    render(<WorkHubSearch onOpen={onOpen} />);
    fireEvent.change(screen.getByLabelText("Search Work Hub"), { target: { value: "Pump" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open Pump 3" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Not found");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("distinguishes loading and no results", async () => {
    let resolve!: (value: unknown) => void;
    network.api.mockReturnValue(new Promise(done => { resolve = done; }));
    render(<WorkHubSearch onOpen={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search Work Hub"), { target: { value: "missing" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByText("Searching…")).toBeTruthy();
    resolve({ results: [], cappedSources: [] });
    expect(await screen.findByText("No authorized results found.")).toBeTruthy();
  });

  it("continues a stable inventory page using the server cursor", async () => {
    network.api.mockResolvedValueOnce({ results: [{ id: "asset:one", subjectType: "asset", subjectId: "one", title: "Pump One", destination: { module: "files-notes", section: "inventory", assetId: "one" } }], cappedSources: ["asset"], nextCursor: "cursor-token" })
      .mockResolvedValueOnce({ results: [{ id: "asset:two", subjectType: "asset", subjectId: "two", title: "Pump Two", destination: { module: "files-notes", section: "inventory", assetId: "two" } }], cappedSources: [], nextCursor: null });
    render(<WorkHubSearch onOpen={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search Work Hub"), { target: { value: "Pump" } });
    fireEvent.click(screen.getByRole("button", { name: "Inventory" }));
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(await screen.findByRole("button", { name: "Load more inventory results" }));
    expect(network.api).toHaveBeenLastCalledWith("/api/work-hub/search?q=Pump&type=asset&cursor=cursor-token");
    expect(await screen.findByRole("button", { name: "Open Pump Two" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Pump One" })).toBeTruthy();
  });

  it("does not imply recency when an unordered channel scan is capped", async () => {
    network.api.mockResolvedValue({ results: [], cappedSources: ["channel"], nextCursor: null });
    render(<WorkHubSearch onOpen={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search Work Hub"), { target: { value: "handoff" } });
    fireEvent.click(screen.getByRole("button", { name: "Notes" }));
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText(/Results may be limited for channel/)).toBeTruthy();
    expect(screen.queryByText(/Recent results only/)).toBeNull();
  });
});
