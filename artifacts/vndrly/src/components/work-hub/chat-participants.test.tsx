import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { ChatParticipants } from "./chat-participants";
const mocks = vi.hoisted(() => ({ request: vi.fn(), canManage: true }));
vi.mock("@/lib/work-hub-client", () => ({ workHubRequest: mocks.request }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 7 } }) }));
vi.mock("@/components/brand-pill-button", () => ({ default: ({ children, tone, ...props }: any) => <button {...props}>{children}</button> }));
beforeEach(() => { mocks.request.mockReset(); mocks.canManage = true; mocks.request.mockImplementation(async (path: string, init?: RequestInit) => {
  if (init) return { saved: true };
  if (path.endsWith("member-access")) return { canManage: mocks.canManage };
  return [{ id: 9, displayName: "Mock Maria" }, { id: 10, displayName: "Mock Isaac" }];
}); });
function mount() { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ChatParticipants channelId="chat" creatorId={7} members={[{ userId: 7, displayName: "Creator" }, { userId: 8, displayName: "Mock Rudy" }]} /></QueryClientProvider>); }
it("stages multiple participant changes and sends only on Save", async () => {
  mount(); fireEvent.change(await screen.findByLabelText("Find chat participants"), { target: { value: "Mock" } });
  fireEvent.click(await screen.findByLabelText("Mock Maria")); fireEvent.click(screen.getByLabelText("Mock Isaac")); fireEvent.click(screen.getByLabelText("Remove"));
  expect(mocks.request.mock.calls.some(([, init]) => init)).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Save participants" }));
  await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/channels/chat/chat-participants", { method: "PATCH", body: JSON.stringify({ addUserIds: [9,10], removeUserIds: [8] }) }));
});
it("hides participant editing from ordinary chat members", async () => {
  mocks.canManage = false; mount();
  await waitFor(() => expect(mocks.request).toHaveBeenCalled());
  expect(screen.queryByLabelText("Remove")).toBeNull();
  expect(screen.queryByLabelText("Find chat participants")).toBeNull();
  expect(screen.getByText(/Company admins can view all company chats/)).toBeTruthy();
});
