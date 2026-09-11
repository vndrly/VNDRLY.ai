import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkHubNavigation } from "./navigation";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 7 } }) }));
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

describe("Work Hub navigation", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/work-hub/chat");
    mocks.request.mockReset();
    mocks.request.mockResolvedValue({ pinned: ["activity", "chat", "channels"], order: [], favorites: [], muted: [], drafts: {} });
  });

  it("uses canonical sidebar sizing and keeps compact white edit controls inside each row", async () => {
    mount();
    const navigation = screen.getByLabelText("Work Hub navigation");
    expect(navigation.className).toContain("space-y-[5px]");
    const chat = await screen.findByTestId("nav-chat");
    expect(chat.className).toContain("block");
    const icon = chat.querySelector("svg");
    expect(icon?.getAttribute("class")).toContain("h-4");
    expect(icon?.getAttribute("class")).toContain("w-4");

    screen.getByRole("button", { name: "Customize navigation" }).click();
    const controls = await screen.findAllByRole("button", { name: /^(Pin|Unpin|Move)/ });
    await waitFor(() => expect(controls.length).toBeGreaterThan(2));
    for (const control of controls) {
      expect(control.className).toContain("text-white");
      expect(control.querySelector("svg")?.getAttribute("class")).toContain("h-3");
    }
  });
});
