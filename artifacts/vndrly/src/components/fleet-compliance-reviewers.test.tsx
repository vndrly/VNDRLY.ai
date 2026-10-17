import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { it, expect, vi, afterEach } from "vitest";
import { FleetComplianceReviewers } from "./fleet-compliance-reviewers";
const api = vi.hoisted(() => ({
  complianceConfiguration: vi.fn(),
  setup: vi.fn(),
  saveComplianceReviewers: vi.fn(),
}));
vi.mock("@/lib/fleet-client", () => ({ fleetClient: api }));
vi.mock("./png-pill-rollover", () => ({
  PngPillButton: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("does not overwrite another admin's later appointment change and lets the user reload current access", async () => {
  const config = {
    version: 3,
    isReviewer: false,
    mayAppointReviewers: true,
    reviewerUserIds: [8],
  };
  api.complianceConfiguration
    .mockResolvedValueOnce(config)
    .mockResolvedValue({ ...config, version: 5 });
  api.setup.mockResolvedValue({
    members: [
      { userId: 8, name: "Bob" },
      { userId: 9, name: "Carol" },
    ],
  });
  api.saveComplianceReviewers.mockResolvedValue({
    version: 4,
    reviewerUserIds: [8, 9],
  });
  const changed = vi.fn();
  render(<FleetComplianceReviewers identity="admin7" onChanged={changed} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Change evidence reviewers" }),
  );
  fireEvent.click(await screen.findByRole("checkbox", { name: "Carol" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Review reviewer access" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save reviewer access" }));
  await screen.findByText(/Reviewer access changed again/);
  expect(changed).not.toHaveBeenCalled();
  expect(api.saveComplianceReviewers).toHaveBeenCalledOnce();
  fireEvent.click(
    screen.getByRole("button", { name: "Reload reviewer access" }),
  );
  expect(
    await screen.findByRole("button", { name: "Change evidence reviewers" }),
  ).toBeTruthy();
  expect(api.saveComplianceReviewers).toHaveBeenCalledOnce();
});
it("offers appointment only to an authorized company admin and does not request the membership directory for ordinary reviewers", async () => {
  api.complianceConfiguration.mockResolvedValue({
    version: 3,
    isReviewer: true,
    mayAppointReviewers: false,
    reviewerUserIds: [],
  });
  render(<FleetComplianceReviewers identity="reviewer" onChanged={vi.fn()} />);
  await waitFor(() => expect(api.complianceConfiguration).toHaveBeenCalled());
  expect(screen.queryByText("Change evidence reviewers")).toBeNull();
  expect(api.setup).not.toHaveBeenCalled();
});
it("requires explicit current-member selection and preserves the exact appointment through lost verification", async () => {
  const config = {
    version: 3,
    isReviewer: false,
    mayAppointReviewers: true,
    reviewerUserIds: [8],
  };
  api.complianceConfiguration
    .mockResolvedValueOnce(config)
    .mockRejectedValueOnce(new Error("Lost readback"))
    .mockResolvedValue({ ...config, version: 4, reviewerUserIds: [8, 9] });
  api.setup.mockResolvedValue({
    members: [
      { userId: 8, name: "Bob" },
      { userId: 9, name: "Carol" },
    ],
  });
  api.saveComplianceReviewers.mockResolvedValue({
    version: 4,
    reviewerUserIds: [8, 9],
  });
  const changed = vi.fn();
  render(<FleetComplianceReviewers identity="admin7" onChanged={changed} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Change evidence reviewers" }),
  );
  fireEvent.click(await screen.findByRole("checkbox", { name: "Carol" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Review reviewer access" }),
  );
  expect(api.saveComplianceReviewers).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save reviewer access" }));
  await screen.findByText(/Reviewer access needs verification/);
  expect(changed).not.toHaveBeenCalled();
  const first = api.saveComplianceReviewers.mock.calls[0][0];
  fireEvent.click(
    screen.getByRole("button", { name: "Retry the same reviewer change" }),
  );
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(api.saveComplianceReviewers.mock.calls[1][0]).toEqual(first);
  expect(first).toMatchObject({ expectedVersion: 3, reviewerUserIds: [8, 9] });
});
