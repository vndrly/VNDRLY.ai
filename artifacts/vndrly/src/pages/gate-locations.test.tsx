import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const state = vi.hoisted(() => ({ map: vi.fn(), admin: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 1, vendorId: 41, activeMembershipId: 2 } }) }));
vi.mock("@/components/content-pane-back-link", () => ({ default: () => <a href="/">Back</a> }));
vi.mock("@/components/gate-coverage-map", () => ({ GateCoverageMap: (props: unknown) => { state.map(props); return <section aria-label="Gate coverage map" />; } }));
vi.mock("@/components/gate-create-card", () => ({ default: (props: unknown) => { state.admin(props); return <section aria-label="Administrative functions" />; } }));
import GateLocationsPage from "./gate-locations";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
function mount() {
 render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><GateLocationsPage /></QueryClientProvider>);
}
it("uses the same authorized map and admin lists as Gate Map without an additional site filter", () => {
 mount();
 expect(state.map).toHaveBeenLastCalledWith(expect.objectContaining({showGateSelector:true}));
 expect(state.map.mock.lastCall?.[0]).not.toHaveProperty("allowedSiteIds");
 expect(state.admin.mock.lastCall?.[0]).not.toHaveProperty("allowedSiteIds");
 expect(screen.queryByRole("region",{name:"Gate location setup"})).toBeNull();
 expect(screen.getByRole("region",{name:"Gate coverage map"}).compareDocumentPosition(screen.getByRole("region",{name:"Administrative functions"})) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
