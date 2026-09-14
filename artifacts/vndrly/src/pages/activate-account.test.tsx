import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ActivateAccount from "./activate-account";

describe("ActivateAccount", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/activate-account?token=" + "a".repeat(64));
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          state: "pending",
          username: "worker@example.invalid",
          sponsorName: "MidCon Solutions",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ state: "claimed" }) }));
  });

  it("sets the first password and records the one-time work authorization in place", async () => {
    render(<ActivateAccount />);
    expect(await screen.findByText(/MidCon Solutions created your account/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Create password"), {
      target: { value: "Unique first password 42!" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "Unique first password 42!" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /work participation authorization/i }));
    fireEvent.click(screen.getByRole("button", { name: "Activate account" }));

    await screen.findByText("Your account is ready");
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const [, request] = vi.mocked(fetch).mock.calls[1]!;
    expect(JSON.parse(String(request?.body))).toEqual({
      password: "Unique first password 42!",
      authorizationVersion: "work-participation-2026-09",
    });
  });
});
