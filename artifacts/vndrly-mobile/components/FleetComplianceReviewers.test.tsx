import React from "react";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import { it, expect, vi, afterEach } from "vitest";
import FleetComplianceReviewers from "./FleetComplianceReviewers";
const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: mocks.api }));
vi.mock("@/lib/auth", () => ({
  captureAuthScope: () => ({ generation: 1 }),
  isAuthScopeCurrent: () => true,
}));
vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    text: "white",
    card: "gray",
    primary: "gold",
    destructive: "red",
  }),
}));
vi.mock("./TogglePillButton", () => ({
  default: ({ children, onPress, disabled }: any) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
afterEach(() => {
  cleanup();
  mocks.api.mockReset();
});
it("does not infer private access appointment from an operational or reviewer role", async () => {
  mocks.api.mockResolvedValue({
    version: 3,
    isReviewer: true,
    mayAppointReviewers: false,
    reviewerUserIds: [],
  });
  render(<FleetComplianceReviewers onChanged={vi.fn()} />);
  await waitFor(() => expect(mocks.api).toHaveBeenCalledOnce());
  expect(screen.queryByText("Change evidence reviewers")).toBeNull();
  expect(mocks.api.mock.calls[0][0]).toBe(
    "/api/fleet/compliance/configuration",
  );
});
it("uses explicit branded member choices and retries an uncertain native appointment with the same original command", async () => {
  const config = {
      version: 3,
      isReviewer: false,
      mayAppointReviewers: true,
      reviewerUserIds: [8],
    },
    sent: any[] = [],
    changed = vi.fn();
  let reads = 0;
  mocks.api.mockImplementation(async (path: string, options: any) => {
    if (path.endsWith("/configuration")) {
      reads++;
      if (reads === 2) throw new Error("Lost readback");
      return reads > 2
        ? { ...config, version: 4, reviewerUserIds: [8, 9] }
        : config;
    }
    if (path.endsWith("/setup"))
      return {
        members: [
          { userId: 8, name: "Bob" },
          { userId: 9, name: "Carol" },
        ],
      };
    sent.push(JSON.parse(options.body));
    return { version: 4, reviewerUserIds: [8, 9] };
  });
  render(<FleetComplianceReviewers onChanged={changed} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Change evidence reviewers" }),
  );
  fireEvent.click(await screen.findByRole("checkbox", { name: "Carol" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Review reviewer access" }),
  );
  expect(sent).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Save reviewer access" }));
  await screen.findByText(/Reviewer access needs verification/);
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Retry the same reviewer change" }),
  );
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(sent[1]).toEqual(sent[0]);
  expect(sent[0]).toMatchObject({
    expectedVersion: 3,
    reviewerUserIds: [8, 9],
  });
});
