import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const api = vi.hoisted(() => vi.fn());
vi.mock("@/lib/change-over-api", () => ({ changeOverRequest: api }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 1, vendorId: 7 } }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => ({ "changeOver.site": "Site", "changeOver.gate": "Gate", "changeOver.choose": "Choose" } as Record<string,string>)[key] ?? key }) }));
import GateSiteGateSelect from "./gate-site-gate-select";
afterEach(cleanup);

it("lists each site and gate together and changes both IDs in one selection", async () => {
  api.mockResolvedValue({ gates: [
    { id: "a1", siteId: 1, name: "Gate 1" }, { id: "a2", siteId: 1, name: "Gate 2" },
    { id: "b1", siteId: 2, name: "North" }, { id: "outside", siteId: 99, name: "Other company" },
  ] });
  const change = vi.fn();
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}})}>
    <GateSiteGateSelect sites={[{id:1,name:"Site A"},{id:2,name:"Site B"}]} siteId={1} gate={{id:"a1",name:"Gate 1"}}
      onChange={change} gpsStatus="mismatch" gpsLabel="Outside selected location" />
  </QueryClientProvider>);
  await screen.findByRole("option", { name: "Site B | North" });
  const select = screen.getByRole("combobox", { name: "Site | Gate" });
  expect(within(select).getAllByRole("option").map(row => row.textContent)).toEqual(["Choose","Site A | Gate 1","Site A | Gate 2","Site B | North"]);
  expect(screen.getByTestId("gate-gps-indicator").contains(select)).toBe(true);
  expect(screen.getByTestId("gate-gps-indicator").getAttribute("data-gps-status")).toBe("mismatch");
  expect(change).not.toHaveBeenCalled();
  fireEvent.change(select, { target: { value: "a2" } });
  expect(change).toHaveBeenLastCalledWith(1, "a2");
  fireEvent.change(select, { target: { value: "b1" } });
  expect(change).toHaveBeenLastCalledWith(2, "b1");
});
