vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 7, activeMembershipId: 1 } }) }));
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FilesAndNotes } from "./files-and-notes";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./files", () => ({ WorkHubFiles: () => <div>Working file library</div> }));
vi.mock("./collaboration", () => ({ HubError: ({ error }: any) => error ? <p role="alert">{error.message}</p> : null }));
vi.mock("@/components/brand-pill-button", () => ({ default: ({ children, tone: _tone, ...props }: any) => <button {...props}>{children}</button> }));
vi.mock("@/components/png-pill-rollover", () => ({
  brandImagePillSrc: () => "brand-pill.png",
  PngPillButton: ({ children, activeSrc: _activeSrc, idleSrc: _idleSrc, ...props }: any) => <button {...props}>{children}</button>,
}));
vi.mock("@/hooks/use-brand", () => ({ useBrand: () => ({ primary: "#0f766e", name: "MidCon Solutions" }) }));
vi.mock("@/lib/work-hub-client", async importOriginal => ({ ...await importOriginal<any>(), workHubRequest: mocks.request }));
describe("Files and native notes", () => {
  beforeEach(() => {
    mocks.request.mockReset();
    mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init) return {};
      if (path === "/channels") return [{ id: "shared", name: "Shared crew", ownerOrgType: "partner", ownerOrgId: 88 }];
      return [{ id: "note", title: "Safety briefing", body: "Original", version: 4, updatedAt: "2026-09-09T12:00:00Z" }];
    });
  });
  it("keeps native notes accessible alongside the new file library and uses their owner's versioned contract", async () => {
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><FilesAndNotes/></QueryClientProvider>);
    expect(screen.getByRole("heading", { name: "Files & Notes" }).closest("section")?.className).toContain("rounded-xl");
    expect(screen.getByRole("tab", { name: "File library" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Working file library")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Native notes" }));
    expect(screen.getByRole("tab", { name: "Native notes" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(await screen.findByRole("button", { name: "Edit note" }));
    fireEvent.change(screen.getByLabelText("Note text"), { target: { value: "Updated briefing" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/channels/shared/notes/note", expect.objectContaining({ method: "PATCH" })));
    const call = mocks.request.mock.calls.find(([path, init]) => path === "/channels/shared/notes/note" && init)!;
    expect(JSON.parse(call[1].body)).toMatchObject({ owner: { type: "partner", id: 88 }, expectedVersion: 4, payload: { title: "Safety briefing", body: "Updated briefing" } });
  });
});
