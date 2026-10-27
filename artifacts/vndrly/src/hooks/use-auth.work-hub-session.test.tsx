import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth } from "./use-auth";
import { workHubRequest } from "@/lib/work-hub-client";

vi.mock("@/lib/fleet-offline-bootstrap", () => ({
  readWebFleetOfflineAuth: vi.fn().mockResolvedValue(null),
  deactivateWebFleetOffline: vi.fn(),
}));
vi.mock("@/lib/i18n", () => ({ default: { language: "en", changeLanguage: vi.fn() } }));

const account = {
  userId: 7, role: "vendor", displayName: "Gate operator", vendorId: 11,
  partnerId: null, vendorPeopleId: 13, vendorRole: "gatekeeper",
  preferredLanguage: "en", activeMembershipId: 9, availableMemberships: [],
  requiresContextChoice: false, mustChangePassword: false,
};

function View() {
  const { user, isLoading } = useAuth();
  return <>
    <p>{isLoading ? "Checking session" : user ? user.displayName : "Sign in required"}</p>
    <button onClick={() => { void workHubRequest("/channels").catch(() => {}); }}>Read conversations</button>
  </>;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("recognizes a session restored in another tab when the user returns to Conversations", async () => {
  let sessionReads = 0;
  vi.stubGlobal("fetch", vi.fn(async () => {
    sessionReads++;
    return sessionReads === 1
      ? new Response(JSON.stringify({ message: "Not authenticated" }), { status: 401 })
      : new Response(JSON.stringify(account));
  }));
  render(<AuthProvider><View /></AuthProvider>);
  await screen.findByText("Sign in required");
  fireEvent.focus(window);
  await screen.findByText("Gate operator");
});

it("does not discard an established session when a focus recheck encounters a temporary server failure", async () => {
  let sessionReads = 0;
  vi.stubGlobal("fetch", vi.fn(async () => {
    sessionReads++;
    return sessionReads === 1
      ? new Response(JSON.stringify(account))
      : new Response(JSON.stringify({ error: "Temporarily unavailable" }), { status: 503 });
  }));
  render(<AuthProvider><View /></AuthProvider>);
  await screen.findByText("Gate operator");
  fireEvent.focus(window);
  await waitFor(() => expect(sessionReads).toBe(2));
  expect(screen.getByText("Gate operator")).toBeTruthy();
});

it("clears stale signed-in state when Conversations rejects the session and the canonical session check also rejects it", async () => {
  let sessionReads = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/api/auth/me") {
      sessionReads++;
      return sessionReads === 1
        ? new Response(JSON.stringify(account))
        : new Response(JSON.stringify({ message: "Not authenticated" }), { status: 401 });
    }
    if (url === "/api/work-hub/channels") return new Response(JSON.stringify({ error: "Authentication required" }), { status: 401 });
    throw Error(`Unexpected request: ${url}`);
  }));
  render(<AuthProvider><View /></AuthProvider>);
  await screen.findByText("Gate operator");
  fireEvent.click(screen.getByRole("button", { name: "Read conversations" }));
  await screen.findByText("Sign in required");
  expect(sessionReads).toBe(2);
});

it("retains a valid newer session when an older Conversations request returns unauthorized", async () => {
  let sessionReads = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/api/auth/me") {
      sessionReads++;
      return new Response(JSON.stringify({ ...account, displayName: sessionReads === 1 ? "Gate operator" : "Current operator" }));
    }
    return new Response(JSON.stringify({ error: "Authentication required" }), { status: 401 });
  }));
  render(<AuthProvider><View /></AuthProvider>);
  await screen.findByText("Gate operator");
  fireEvent.click(screen.getByRole("button", { name: "Read conversations" }));
  await screen.findByText("Current operator");
  expect(screen.queryByText("Sign in required")).toBeNull();
});

it("does not sign out a valid user when a Conversations request is forbidden rather than unauthenticated", async () => {
  let sessionReads = 0;
  const fetcher = vi.fn(async (url: string) => {
    if (url === "/api/auth/me") { sessionReads++; return new Response(JSON.stringify(account)); }
    return new Response(JSON.stringify({ error: "Not permitted" }), { status: 403 });
  });
  vi.stubGlobal("fetch", fetcher);
  render(<AuthProvider><View /></AuthProvider>);
  await screen.findByText("Gate operator");
  fireEvent.click(screen.getByRole("button", { name: "Read conversations" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(sessionReads).toBe(1);
  expect(screen.getByText("Gate operator")).toBeTruthy();
});
