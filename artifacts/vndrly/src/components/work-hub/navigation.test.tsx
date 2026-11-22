import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkHubNavigation } from "./navigation";

const mocks = vi.hoisted(() => ({ request: vi.fn(), user: { userId: 7, role: "vendor", vendorRole: "office" } }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/hooks/use-brand", () => ({ useBrand: () => ({ primary: "#3260CD", name: "MidCon Solutions" }) }));
vi.mock("@/lib/work-hub-client", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  workHubRequest: mocks.request,
}));

function mount() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <WorkHubNavigation />
    </QueryClientProvider>,
  );
}

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe("Work Hub navigation", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/work-hub/chat");
    mocks.user.role = "vendor";
    mocks.user.vendorRole = "office";
    mocks.request.mockReset();
    mocks.request.mockResolvedValue({ pinned: ["activity", "chat", "channels"], order: [], favorites: [], muted: [], drafts: {} });
  });

  it("hides office controls from gatekeepers", () => {
    mocks.user.vendorRole = "gatekeeper";
    mount();
    expect(screen.queryByTestId("nav-go-to-admin")).toBeNull();
    expect(screen.queryByRole("button", {name:"More"})).toBeNull();
  });

  it("keeps Admin access without More or Import & Export", () => {
    mount();
    const admin = screen.getByTestId("nav-go-to-admin");
    expect(admin).toBeTruthy();
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
    expect(screen.queryByText("Import & Export")).toBeNull();
  });

  it("returns office staff to Admin immediately without a PIN request", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    mount();
    fireEvent.click(screen.getByTestId("nav-go-to-admin"));
    await waitFor(() => expect(window.location.pathname).toBe("/"));
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("gateNav.enterPin")).toBeNull();
  });

  it("keeps canonical sizing and exposes office pages without customization controls", async () => {
    mount();
    const navigation = screen.getByLabelText("Work Hub navigation");
    expect(navigation.className).toContain("space-y-0");
    const chat = await screen.findByTestId("nav-chat");
    expect(chat.className).toContain("block");
    const icon = chat.querySelector("svg");
    expect(icon?.getAttribute("class")).toContain("h-4");
    expect(icon?.getAttribute("class")).toContain("w-4");

    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
    expect(screen.queryAllByRole("button", { name: /^(Pin|Unpin|Move)/ })).toHaveLength(0);
    expect(screen.getByTestId("nav-search")).toBeTruthy();
  });
});
