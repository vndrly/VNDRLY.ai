import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
    if (path.endsWith("/site-locations/offer-previews")) return Response.json(accepted ? [] : [offer]);
    if (path.endsWith("/site-locations")) {
      return Response.json(accepted
        ? [assigned, { ...offer, address: "Full site address", siteCode: "SITE-ACCEPTED", status: "active" }]
        : [assigned]);
    }
    return Response.json(path.endsWith("/safety/capabilities") ? { isPartnerHse: false } : []);
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><SiteLocations /></QueryClientProvider>);

  const preview = await screen.findByTestId("row-site-1");
  expect(within(preview).getByText("Offer pending")).toBeTruthy();
  expect(within(preview).queryByRole("link")).toBeNull();
  expect(await screen.findByRole("link", { name: "Assigned Site" })).toBeTruthy();

  accepted = true;
  await act(async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: getListSiteOfferPreviewsQueryKey() }),
      client.invalidateQueries({ queryKey: getListSiteLocationsQueryKey() }),
    ]);
  });
  await waitFor(() => expect(screen.getByRole("link", { name: "Offered Site" }).getAttribute("href")).toBe("/site-locations/1"));
  expect(screen.queryByText("Offer pending")).toBeNull();
  expect(screen.getAllByTestId("row-site-1")).toHaveLength(1);
});
