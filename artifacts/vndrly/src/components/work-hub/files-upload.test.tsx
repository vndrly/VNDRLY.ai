import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkHubFiles } from "./files";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { userId: 7, vendorId: 1, activeMembershipId: 1 } }),
}));
vi.mock("@/lib/work-hub-client", () => ({
  ownerForUser: () => ({ type: "vendor", id: 1 }),
  createWorkHubOperationId: () => "operation-1",
  commandEnvelope: (owner: unknown, payload: unknown, operationId?: string) => ({ owner, payload, operationId }),
  workHubRequest: mocks.request,
}));
vi.mock("@/components/brand-pill-button", () => ({
  default: ({ children, tone: _tone, ...props }: any) => <button {...props}>{children}</button>,
}));

describe("Work Hub explicit file upload", () => {
  beforeEach(() => {
    mocks.request.mockReset();
    mocks.request.mockImplementation(async (path: string) => {
      if (path === "/file-library?orgType=vendor&orgId=1") return [];
      if (path === "/channels") return [];
      return {};
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("stages the chosen file until the branded Upload File action is pressed", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <WorkHubFiles />
      </QueryClientProvider>,
    );
    const upload = screen.getByRole("button", { name: "Upload File" }) as HTMLButtonElement;
    expect(upload.disabled).toBe(true);
    const file = new File(["field notes"], "notes.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("Choose file to upload"), { target: { files: [file] } });
    await waitFor(() => expect(upload.disabled).toBe(false));
    expect(mocks.request).not.toHaveBeenCalledWith("/file-library/reserve", expect.anything());
    expect(upload.className).toContain("w-fit");
  });

  it("keeps the staged file available for retry after an upload failure", async () => {
    mocks.request.mockImplementation(async (path: string) => {
      if (path === "/file-library?orgType=vendor&orgId=1") return [];
      if (path === "/channels") return [];
      if (path === "/file-library/reserve") {
        return { resource: { documentId: "doc-1", fileId: "file-1", uploadURL: "https://upload.invalid/file" } };
      }
      return {};
    });
    const fetchUpload = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchUpload);
    vi.stubGlobal("crypto", { subtle: { digest: vi.fn(async () => new ArrayBuffer(32)) } });

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <WorkHubFiles />
      </QueryClientProvider>,
    );
    const file = new File(["field notes"], "notes.txt", { type: "text/plain" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new TextEncoder().encode("field notes").buffer });
    fireEvent.change(screen.getByLabelText("Choose file to upload"), { target: { files: [file] } });
    const upload = screen.getByRole("button", { name: "Upload File" }) as HTMLButtonElement;
    fireEvent.click(upload);
    await screen.findByRole("alert");
    expect(upload.disabled).toBe(false);
    fireEvent.click(upload);
    await waitFor(() => expect(fetchUpload).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(upload.disabled).toBe(true));
    expect(mocks.request.mock.calls.filter(([path]) => path === "/file-library/reserve")).toHaveLength(1);
    expect(mocks.request).toHaveBeenCalledWith("/file-library/finalize", expect.anything());
  });

  it("reuses the finalization operation after an ambiguous response failure", async () => {
    let finalizeAttempts = 0;
    mocks.request.mockImplementation(async (path: string) => {
      if (path === "/file-library?orgType=vendor&orgId=1") return [];
      if (path === "/channels") return [];
      if (path === "/file-library/reserve") {
        return { resource: { documentId: "doc-1", fileId: "file-1", uploadURL: "https://upload.invalid/file" } };
      }
      if (path === "/file-library/finalize" && finalizeAttempts++ === 0) {
        throw new Error("Response lost after finalization");
      }
      return {};
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));
    vi.stubGlobal("crypto", { subtle: { digest: vi.fn(async () => new ArrayBuffer(32)) } });

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <WorkHubFiles />
      </QueryClientProvider>,
    );
    const file = new File(["field notes"], "notes.txt", { type: "text/plain" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new TextEncoder().encode("field notes").buffer });
    fireEvent.change(screen.getByLabelText("Choose file to upload"), { target: { files: [file] } });
    const upload = screen.getByRole("button", { name: "Upload File" }) as HTMLButtonElement;
    fireEvent.click(upload);
    await screen.findByRole("alert");
    fireEvent.click(upload);

    await waitFor(() => expect(upload.disabled).toBe(true));
    expect(mocks.request.mock.calls.filter(([path]) => path === "/file-library/reserve")).toHaveLength(1);
    const finalizeCalls = mocks.request.mock.calls.filter(([path]) => path === "/file-library/finalize");
    expect(finalizeCalls).toHaveLength(2);
    const operationIds = finalizeCalls.map(([, options]) => JSON.parse(options.body).operationId);
    expect(new Set(operationIds).size).toBe(1);
  });

  it("clears a staged replacement when replacement is cancelled", async () => {
    mocks.request.mockImplementation(async (path: string) => {
      if (path === "/file-library?orgType=vendor&orgId=1") {
        return [{
          id: "existing-doc",
          createdBy: 7,
          orgType: "vendor",
          orgId: 1,
          data: {
            name: "existing.txt",
            scope: "personal",
            channelId: null,
            state: "active",
            versions: ["file-old"],
            currentFileId: "file-old",
          },
          favorite: false,
          canManage: true,
        }];
      }
      if (path === "/channels") return [];
      return {};
    });

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <WorkHubFiles />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Replace file" }));
    const replacement = new File(["replacement"], "replacement.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("Choose file to upload"), { target: { files: [replacement] } });
    expect(screen.getByText(/Replacing existing\.txt/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Upload File" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Cancel replacement" }));
    expect(screen.queryByText(/Replacing existing\.txt/)).toBeNull();
    expect((screen.getByRole("button", { name: "Upload File" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
