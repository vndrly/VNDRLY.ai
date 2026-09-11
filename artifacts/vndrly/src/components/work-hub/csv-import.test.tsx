vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 7, activeMembershipId: 1 } }) }));
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CsvImport } from "./csv-import";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./collaboration", () => ({ HubError: ({ error }: any) => error ? <p role="alert">{error.message}</p> : null }));
vi.mock("@/components/brand-pill-button", () => ({ default: ({ children, tone: _tone, ...props }: any) => <button {...props}>{children}</button> }));
vi.mock("@/lib/work-hub-client", async importOriginal => ({ ...await importOriginal<any>(), workHubRequest: mocks.request }));
describe("CSV import confirmation", () => {
  beforeEach(() => {
    mocks.request.mockReset();
    mocks.request.mockImplementation(async (path: string) => {
      if (path === "/transfers/preview") return { batch: { id: "batch" }, items: [{ id: "row", status: "staged", payload: { title: "Review", rowNumber: 2 } }] };
      if (path === "/transfers/batch/apply") return { imported: 1, duplicates: 0, errors: 0 };
      return [];
    });
  });
  it("stages mapped work fields and waits for explicit confirmation before creating records", async () => {
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CsvImport/></QueryClientProvider>);
    fireEvent.change(screen.getByPlaceholderText("Example: Microsoft Operations export"), { target: { value: "Operations" } });
    const file = new File(["ID,Name\n1,Review"], "work.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => "ID,Name\n1,Review" });
    fireEvent.change(screen.getByLabelText("CSV import file"), { target: { files: [file] } });
    fireEvent.change(await screen.findByLabelText("External ID column"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Title column"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Validate and stage preview" }));
    const confirm = await screen.findByRole("button", { name: "Confirm and import ready rows" });
    expect(mocks.request.mock.calls.some(([path]) => path.endsWith("/apply"))).toBe(false);
    const preview = mocks.request.mock.calls.find(([path]) => path === "/transfers/preview")!;
    expect(JSON.parse(preview[1].body).rows).toEqual([{ externalId: "1", title: "Review", body: "", dueAt: null }]);
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("1 created"));
    const apply = mocks.request.mock.calls.find(([path]) => path.endsWith("/apply"))!;
    expect(JSON.parse(apply[1].body)).toMatchObject({ confirm: true, operationId: expect.any(String) });
  });
});
