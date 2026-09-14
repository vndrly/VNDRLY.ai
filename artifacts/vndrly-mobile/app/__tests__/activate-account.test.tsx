import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiFetchMock, replaceMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  replaceMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ apiFetch: apiFetchMock }));
vi.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ token: "a".repeat(64) }),
  router: { replace: replaceMock },
  Stack: { Screen: () => null },
}));
vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#fff",
    foreground: "#111",
    card: "#fff",
    border: "#aaa",
    primary: "#007a96",
    mutedForeground: "#666",
    destructive: "#b91c1c",
  }),
}));
vi.mock("react-native-safe-area-context", async () => {
  const ReactNative = await import("react-native");
  return { SafeAreaView: ReactNative.View };
});

import ActivateAccount from "../activate-account";

describe("mobile account activation", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock
      .mockResolvedValueOnce({
        state: "pending",
        username: "worker@example.invalid",
        sponsorName: "MidCon Solutions",
      })
      .mockResolvedValueOnce({ state: "claimed" });
  });

  it("activates without leaving the app or using a temporary password", async () => {
    render(<ActivateAccount />);
    expect(await screen.findByText(/MidCon Solutions created your account/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Create password"), { target: { value: "Unique first password 42!" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "Unique first password 42!" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /work participation authorization/i }));
    fireEvent.click(screen.getByRole("button", { name: "Activate account" }));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(2));
    expect(apiFetchMock).toHaveBeenLastCalledWith(
      `/api/implementation-a/account-invitations/activate/${"a".repeat(64)}`,
      expect.objectContaining({ method: "POST" }),
    );
  });
});
