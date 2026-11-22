import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const env = vi.hoisted(() => ({
  request: vi.fn(),
  invalidate: vi.fn(),
  accounts: [] as any[],
}));
vi.mock("./connector-client", () => ({
  connectorRequest: env.request,
  useAccounts: () => ({ data: { accounts: env.accounts } }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: env.invalidate }),
}));
vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({ primary: "#00bcd4" }),
}));
vi.mock("./chrome", () => ({
  WorkHubMiniCardButton: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: any) => (open ? <div>{children}</div> : null),
}));
vi.mock("@/components/mini-card-dialog-content", () => ({
  default: ({ children, label, icon: Icon }: any) => (
    <div role="dialog" aria-label={label}>
      <Icon />
      {children}
    </div>
  ),
}));
import { CommunicationConnections } from "./communication-connections";
beforeEach(() => {
  env.request.mockReset();
  env.accounts = [];
  vi.spyOn(window, "open").mockReturnValue({
    location: { href: "" },
    close: vi.fn(),
  } as any);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it.each(["Teams", "Outlook", "Gmail", "Slack"])(
  "starts real %s OAuth from its logo button",
  async (provider) => {
    env.request.mockResolvedValue({
      id: "attempt-1",
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    });
    render(<CommunicationConnections />);
    fireEvent.click(
      screen.getByRole("button", { name: `Connect ${provider}` }),
    );
    expect(screen.getByRole("dialog").querySelector("img")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: `Add ${provider} account` }),
    );
    await waitFor(() =>
      expect(env.request).toHaveBeenCalledWith(
        `/${provider.toLowerCase()}/connect`,
        {},
      ),
    );
    const signIn = await screen.findByRole("link", { name: `Continue to ${provider}` });
    expect(signIn.getAttribute("href")).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(signIn.getAttribute("rel")).toBe("noopener noreferrer");
    expect(window.open).not.toHaveBeenCalled();
  },
);
it("keeps multiple Outlook accounts distinct and disconnects only the selected account", async () => {
  env.accounts = [
    {
      id: "one",
      provider: "outlook",
      label: "one@example.com",
      status: "connected",
    },
    {
      id: "two",
      provider: "outlook",
      label: "two@example.com",
      status: "connected",
    },
  ];
  env.request.mockResolvedValue({ disconnected: true });
  render(<CommunicationConnections />);
  fireEvent.click(screen.getByRole("button", { name: "Connect Outlook" }));
  expect(screen.getByText("one@example.com")).toBeTruthy();
  expect(screen.getByText("two@example.com")).toBeTruthy();
  fireEvent.click(screen.getAllByRole("button", { name: "Disconnect" })[1]);
  await waitFor(() =>
    expect(env.request).toHaveBeenCalledWith("/accounts/two/disconnect", {}),
  );
});
it("reports missing registration without pretending an account connected", async () => {
  env.request.mockRejectedValue(new Error("gmail registration required"));
  render(<CommunicationConnections />);
  fireEvent.click(screen.getByRole("button", { name: "Connect Gmail" }));
  fireEvent.click(screen.getByRole("button", { name: "Add Gmail account" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "gmail registration required",
  );
});
it("does not expose an untrusted authorization address", async () => {
  env.request.mockResolvedValue({ id: "attempt-1", authorizationUrl: "https://example.com/signin" });
  render(<CommunicationConnections />);
  fireEvent.click(screen.getByRole("button", { name: "Connect Gmail" }));
  fireEvent.click(screen.getByRole("button", { name: "Add Gmail account" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Invalid authorization address");
  expect(screen.queryByRole("link")).toBeNull();
  expect(window.open).not.toHaveBeenCalled();
});
