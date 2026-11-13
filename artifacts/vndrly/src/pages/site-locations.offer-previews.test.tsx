import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { getListSiteLocationsQueryKey, getListSiteOfferPreviewsQueryKey } from "@workspace/api-client-react";
import "@/lib/i18n";
import SiteLocations from "./site-locations";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { role: "vendor", vendorId: 7 } }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("renders offer previews without site detail links and shows the full site after acceptance", async () => {
  const offer = { id: 1, name: "Offered Site", partnerId: 2, partnerName: "Partner" };
  const assigned = { ...offer, id: 3, name: "Assigned Site", address: "Site address", siteCode: "SITE-ASSIGNED", status: "active" };
  let accepted = false;
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const path = new URL(input instanceof Request ? input.url : input, window.location.origin).pathname;
    if (path.endsWith("/tickets")) return Response.json({items:[],total:0});
    if (path.endsWith("/site-locations/offer-previews")) return Response.json(accepted ? [] : [offer]);
    if (path.endsWith("/site-locations")) {
      return Response.json(accepted
        ? [assigned, { ...offer, address: "Full site address", siteCode: "SITE-ACCEPTED", status: "active" }]
        : [assigned]);
    }
    return Response.json(path.endsWith("/safety/capabilities") ? { isPartnerHse: false } : []);
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><SiteLocations embedded /></QueryClientProvider>);

  expect(screen.queryByTestId("text-page-title")).toBeNull();
  const preview = await screen.findByTestId("row-site-1");
  expect(within(preview).getByText("Offer pending")).toBeTruthy();
  expect(within(preview).queryByRole("link")).toBeNull();
  const assignedRow = await screen.findByTestId("row-site-3");
  expect(within(assignedRow).getByRole("button").getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(within(assignedRow).getByRole("button"));
  expect((await screen.findByTestId("link-site-3")).getAttribute("href")).toBe("/mapping/sites/3");

  accepted = true;
  await act(async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: getListSiteOfferPreviewsQueryKey() }),
      client.invalidateQueries({ queryKey: getListSiteLocationsQueryKey() }),
    ]);
  });
  await waitFor(() => expect(within(screen.getByTestId("row-site-1")).getByRole("button").getAttribute("aria-expanded")).toBe("false"));
  expect(screen.queryByText("Offer pending")).toBeNull();
  expect(screen.getAllByTestId("row-site-1")).toHaveLength(1);
});
