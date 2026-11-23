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
  open: vi.fn(),
  invalidate: vi.fn(),
  accounts: [] as any[],
}));
vi.mock("./connector-client", () => ({
  request: env.request,
  useAccounts: () => ({ data: { accounts: env.accounts } }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: env.invalidate }),
}));
vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({ primary: "#00bcd4" }),
}));
vi.mock("react-native", () => ({
  Linking: { openURL: env.open },
  View: ({ children }: any) => <div>{children}</div>,
  Text: ({ children }: any) => <span>{children}</span>,
}));
vi.mock("@/components/ProfileMiniCardButton", () => ({
  default: ({ children, onPress, disabled }: any) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/DismissibleModal", () => ({
  default: ({ visible, children }: any) =>
    visible ? <div>{children}</div> : null,
}));
vi.mock("./ProviderLogo", () => ({ default: () => <span /> }));
import CommunicationConnections from "./CommunicationConnections";
beforeEach(() => {
  env.request.mockReset();
  env.open.mockReset();
  env.accounts = [];
});
afterEach(cleanup);
it.each(["Teams", "Outlook", "Gmail", "Slack"])(
  "starts real %s authorization in the system browser",
  async (provider) => {
    env.request.mockResolvedValue({
      id: "attempt-1",
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    });
    render(<CommunicationConnections />);
    fireEvent.click(
      screen.getByRole("button", { name: `Connect ${provider}` }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: `Add ${provider} account` }),
    );
    await waitFor(() =>
      expect(env.request).toHaveBeenCalledWith(
        `/${provider.toLowerCase()}/connect`,
        {},
      ),
    );
    expect(env.open).toHaveBeenCalledWith(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
  },
);
it("does not open an untrusted authorization origin", async () => {
  env.request.mockResolvedValue({
    id: "attempt-1",
    authorizationUrl: "https://attacker.example/signin",
  });
  render(<CommunicationConnections />);
  fireEvent.click(screen.getByRole("button", { name: "Connect Gmail" }));
  fireEvent.click(screen.getByRole("button", { name: "Add Gmail account" }));
  await screen.findByText("Invalid authorization address.");
  expect(env.open).not.toHaveBeenCalled();
});
it("lists two mail accounts independently", () => {
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
  render(<CommunicationConnections />);
  fireEvent.click(screen.getByRole("button", { name: "Connect Outlook" }));
  expect(screen.getByText("one@example.com")).toBeTruthy();
  expect(screen.getByText("two@example.com")).toBeTruthy();
});
