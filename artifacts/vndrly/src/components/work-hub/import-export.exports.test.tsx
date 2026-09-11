import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImportExportTools } from "./import-export";

const mocks = vi.hoisted(() => ({ request: vi.fn(), admin: true }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 22, role: "vendor", vendorId: 41, membershipRole: mocks.admin ? "admin" : "member", activeMembershipId: 1, availableMemberships: [{ id: 1, role: mocks.admin ? "admin" : "member" }] } }) }));
vi.mock("@/components/brand-pill-button", () => ({ default: ({ children, ...props }: any) => <button {...props}>{children}</button> }));
vi.mock("@/lib/work-hub-client", async (importOriginal) => ({ ...await importOriginal<any>(), workHubRequest: mocks.request, createWorkHubOperationId: () => "11111111-1111-4111-8111-111111111111" }));

function mount() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ImportExportTools /></QueryClientProvider>); }

describe("governed Work Hub exports", () => {
  beforeEach(() => { mocks.request.mockReset(); mocks.admin = true; mocks.request.mockResolvedValue({ batches: [], items: [] }); });

  it("hides export controls from users without policy management authority", () => {
    mocks.admin = false;
    mount();
    expect(screen.queryByRole("heading", { name: "Export your authorized records" })).toBeNull();
  });

  it("requires an explicit expiry and requests an asynchronous export", async () => {
    mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/exports" && init?.method === "POST") return { id: "22222222-2222-4222-8222-222222222222", dataset: "tasks", format: "csv", status: "pending", createdAt: "2026-09-10T12:00:00.000Z", updatedAt: "2026-09-10T12:00:00.000Z", rowCount: null, byteCount: null, expiresAt: "2026-09-12T12:00:00.000Z", fileName: null, errorCode: null };
      if (path === "/transfers") return { batches: [], items: [] };
      throw new Error(`unexpected ${path}`);
    });
    mount();
    const create = screen.getByRole("button", { name: "Create export" });
    expect(create.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("Export expiry"), { target: { value: "2026-09-12T12:00" } });
    fireEvent.click(create);
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/exports", expect.objectContaining({ method: "POST" })));
    const body = JSON.parse(mocks.request.mock.calls.find(([path, init]) => path === "/exports" && init?.method === "POST")![1].body);
    expect(body).toMatchObject({ owner: { type: "vendor", id: 41 }, export: { dataset: "tasks", format: "csv", scope: { selectors: {} } } });
    expect(body.expiresAt).toBe(new Date("2026-09-12T12:00").toISOString());
    expect(await screen.findByText("Queued")).toBeTruthy();
  });

  it("shows lifecycle states and exposes a download link only when ready", async () => {
    mocks.request.mockImplementation(async (path: string) => path === "/transfers" ? { batches: [], items: [] } : ({ id: "22222222-2222-4222-8222-222222222222", dataset: "tasks", format: "csv", status: "completed", createdAt: "2026-09-10T12:00:00.000Z", updatedAt: "2026-09-10T12:01:00.000Z", rowCount: 2, byteCount: 40, expiresAt: "2026-09-12T12:00:00.000Z", fileName: "vndrly-work-hub-tasks.csv", errorCode: null }));
    mount();
    fireEvent.change(screen.getByLabelText("Export expiry"), { target: { value: "2026-09-12T12:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Create export" }));
    const link = await screen.findByRole("link", { name: "Download export" });
    expect(link.getAttribute("href")).toBe("/api/work-hub/exports/22222222-2222-4222-8222-222222222222/download");
  });

  it("removes a cached ready download as soon as status reauthorization fails", async () => {
    let statusReads = 0;
    mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/transfers") return { batches: [], items: [] };
      if (path === "/exports" && init?.method === "POST") return { id: "22222222-2222-4222-8222-222222222222", dataset: "tasks", format: "csv", status: "completed", createdAt: "2026-09-10T12:00:00.000Z", updatedAt: "2026-09-10T12:01:00.000Z", rowCount: 2, byteCount: 40, expiresAt: "2026-09-12T12:00:00.000Z", fileName: "vndrly.csv", errorCode: null };
      if (path.includes("/exports/")) {
        statusReads += 1;
        if (statusReads === 1) return { id: "22222222-2222-4222-8222-222222222222", dataset: "tasks", format: "csv", status: "completed", createdAt: "2026-09-10T12:00:00.000Z", updatedAt: "2026-09-10T12:01:00.000Z", rowCount: 2, byteCount: 40, expiresAt: "2026-09-12T12:00:00.000Z", fileName: "vndrly.csv", errorCode: null };
        throw new Error("access changed");
      }
      throw new Error("unexpected");
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ImportExportTools /></QueryClientProvider>);
    fireEvent.change(screen.getByLabelText("Export expiry"), { target: { value: "2026-09-12T12:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Create export" }));
    expect(await screen.findByRole("link", { name: "Download export" })).toBeTruthy();
    await client.invalidateQueries({ queryKey: ["work-hub-export"] });
    expect((await screen.findByRole("alert")).textContent).toContain("Your access changed");
    expect(screen.queryByRole("link", { name: "Download export" })).toBeNull();
  });
});
