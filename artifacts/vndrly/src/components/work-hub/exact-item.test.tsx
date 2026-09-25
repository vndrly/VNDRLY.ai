import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkHubExactItem } from "./exact-item";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("exact Work Hub destination", () => {
  it("uses the managed document reader for file-library IDs, not the legacy file index", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ subjectType: "document", title: "Managed document", status: "active" }) });
    vi.stubGlobal("fetch", fetcher);
    render(<WorkHubExactItem subjectType="document" itemId="7be22c7d-4638-4144-bb18-0d2a66996a43" />);
    await screen.findByText("Managed document");
    expect(fetcher).toHaveBeenCalledWith("/api/work-hub/file-library/7be22c7d-4638-4144-bb18-0d2a66996a43", expect.objectContaining({ credentials: "include" }));
  });
  it("loads the current authorized record instead of displaying the search summary", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ title: "Current task", body: "Current authorized detail", status: "open" }) });
    vi.stubGlobal("fetch", fetcher);
    render(<WorkHubExactItem subjectType="task" itemId="7be22c7d-4638-4144-bb18-0d2a66996a43" />);
    await screen.findByText("Current authorized detail");
    expect(fetcher).toHaveBeenCalledWith("/api/work-hub/search/items/task/7be22c7d-4638-4144-bb18-0d2a66996a43", expect.objectContaining({ credentials: "include" }));
  });
  it("fails closed for revoked or unsupported items", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ title: "Must not show" }) }));
    render(<WorkHubExactItem subjectType="asset" itemId="7be22c7d-4638-4144-bb18-0d2a66996a43" />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.queryByText("Must not show")).toBeNull();
  });
});
