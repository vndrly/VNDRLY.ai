import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/work-hub-client", () => ({ workHubRequest: request }));
import { ConversationTitle } from "./conversation-title";
const mount = (canRename = true) => render(<QueryClientProvider client={new QueryClient()}><ConversationTitle channel={{ id: "chat", name: "Isaac, Tasha", version: 2 }} canRename={canRename} /></QueryClientProvider>);
beforeEach(() => request.mockReset().mockResolvedValue({}));
it.each(["blur", "Enter"])("saves inline on %s without message writes", async action => {
  mount(); fireEvent.click(screen.getByText("Isaac, Tasha"));
  const input = screen.getByLabelText("Conversation title");
  fireEvent.change(input, { target: { value: "Night watch" } });
  if (action === "blur") fireEvent.blur(input); else fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  expect(request).toHaveBeenCalledWith("/channels/chat", { method: "PATCH", body: JSON.stringify({ name: "Night watch", expectedName: "Isaac, Tasha" }) });
});
it("does not save cancelled edits or offer editing to a reader", () => {
  const view = mount(); fireEvent.click(screen.getByText("Isaac, Tasha"));
  fireEvent.keyDown(screen.getByLabelText("Conversation title"), { key: "Escape" });
  expect(request).not.toHaveBeenCalled(); view.unmount(); mount(false);
  expect(screen.queryByRole("button")).toBeNull();
});
