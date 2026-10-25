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
    mocks.user.vendorRole = "office";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ok:true,json:async()=>({ok:true})}));
    mocks.request.mockReset();
    mocks.request.mockResolvedValue({ pinned: ["activity", "chat", "channels"], order: [], favorites: [], muted: [], drafts: {} });
  });

  it("hides office controls from gatekeepers", () => {
    mocks.user.vendorRole = "gatekeeper";
    mount();
    expect(screen.queryByTestId("nav-go-to-admin")).toBeNull();
    expect(screen.queryByRole("button", {name:"More"})).toBeNull();
  });

  it("places Go to Admin immediately before More", () => {
    mount();
    const admin = screen.getByTestId("nav-go-to-admin");
    expect(admin.nextElementSibling?.textContent).toContain("More");
  });

  it("uses canonical sidebar sizing and keeps compact white edit controls inside each row", async () => {
    mount();
    const navigation = screen.getByLabelText("Work Hub navigation");
    expect(navigation.className).toContain("space-y-0");
    const chat = await screen.findByTestId("nav-chat");
    expect(chat.className).toContain("block");
    const icon = chat.querySelector("svg");
    expect(icon?.getAttribute("class")).toContain("h-4");
    expect(icon?.getAttribute("class")).toContain("w-4");

    const more = screen.getByRole("button", { name: "More" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    const pin = screen.getByLabelText(/four|PIN|gateNav.enterPin/i);
    fireEvent.change(pin, { target: { value: "1029" } });
    fireEvent.submit(pin.closest("form")!);
    expect(await screen.findByRole("button", { name: "Done" })).toBeTruthy();
    const controls = await screen.findAllByRole("button", { name: /^(Pin|Unpin|Move)/ });
    await waitFor(() => expect(controls.length).toBeGreaterThan(2));
    for (const control of controls) {
      expect(control.className).toContain("text-white");
      expect(control.querySelector("svg")?.getAttribute("class")).toContain("h-3");
    }
  });
});
