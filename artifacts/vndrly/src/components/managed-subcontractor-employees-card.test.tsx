import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ManagedSubcontractorEmployeesCard from "./managed-subcontractor-employees-card";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({
    primary: "#00a9c8",
    accent: "#00a9c8",
    logoUrl: null,
    logoSquareUrl: null,
    name: "MidCon Solutions",
    isOrgBranded: true,
  }),
}));

afterEach(() => vi.unstubAllGlobals());

function renderCard() {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      items: [{
        id: "company-1",
        name: "NewTech",
        status: "managed",
        workers: [{
          id: "worker-1",
          name: "Alex Worker",
          email: "alex@example.com",
          role: "gatekeeper",
          status: "active",
          siteIds: [3],
        }],
      }],
      sites: [{ id: 3, name: "North Gate" }],
    }),
  }));

  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ManagedSubcontractorEmployeesCard vendorId={4} />
    </QueryClientProvider>,
  );
}

it("uses the organization brand pill for add and edit subcontractor employee actions", async () => {
  renderCard();

  const addAction = await screen.findByRole("button", {
    name: /managedSubcontractors\.addSubcontractedEmployee/,
  });
  const editAction = await screen.findByRole("button", {
    name: /managedSubcontractors\.editAccess/,
  });

  for (const action of [addAction, editAction]) {
    const sources = Array.from(action.querySelectorAll("img"), (image) => image.getAttribute("src") ?? "");
    expect(sources.some((source) => source.includes("pill_midcon_blue"))).toBe(true);
  }
});

it("uses the Ask V header shell and branded fields inside the subcontractor employee modal", async () => {
  renderCard();

  const addAction = await screen.findByRole("button", {
    name: /managedSubcontractors\.addSubcontractedEmployee/,
  });
  await waitFor(() => expect((addAction as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(addAction);

  expect(screen.getByTestId("employee-dialog-header").className).toContain("pt-[70px]");
  expect(screen.getByTestId("employee-dialog-logo")).toBeTruthy();
  expect(screen.getByTestId("employee-dialog-close")).toBeTruthy();

  for (const name of ["managedSubcontractors.subcontractor", "managedSubcontractors.role"]) {
    const select = screen.getByRole("combobox", { name });
    expect(select.className).toContain("rounded-full");
    expect(select.className).toContain("border-[color:var(--brand-primary)]");
    expect(select.className).toContain("[&>option:hover]:bg-[var(--brand-primary)]");
  }

  for (const name of ["managedSubcontractors.workerName", "managedSubcontractors.email"]) {
    const field = screen.getByLabelText(name);
    expect(field.className).toContain("rounded-xl");
    expect(field.className).toContain("border-[color:var(--brand-primary)]");
    expect(field.className).toContain("bg-white");
  }

  const site = screen.getByRole("checkbox", { name: "North Gate" });
  expect(site.className).toContain("data-[state=checked]:bg-[color:var(--brand-primary)]");

  const saveAction = screen.getByRole("button", { name: "managedSubcontractors.saveWorker" });
  const saveSources = Array.from(saveAction.querySelectorAll("img"), (image) => image.getAttribute("src") ?? "");
  expect(saveSources.some((source) => source.includes("pill_midcon_blue"))).toBe(true);
});
