import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import StaffingSummaryList from "./staffing-summary-list";

afterEach(cleanup);
it("opens the profile from the name while invite and removal stay independent", () => {
  const open = vi.fn(), invite = vi.fn(), remove = vi.fn();
  render(<StaffingSummaryList people={[{ id: 1, name: "Bob Smith", email: "bob@example.invalid", phone: "4325551234", role: "Gatekeeper", onOpen: open, enrollment: <button onClick={invite}>SEND</button>, remove: <button aria-label="Remove Bob Smith" onClick={remove}>Trash</button> }]} />);
  expect(screen.getAllByRole("columnheader").map(element => element.textContent)).toEqual(["Name", "Email", "Phone", "Role", "Sent Invite", ""]);
  expect(screen.getByText("(432) 555-1234")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "SEND" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove Bob Smith" }));
  expect(invite).toHaveBeenCalledOnce(); expect(remove).toHaveBeenCalledOnce(); expect(open).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Bob Smith" }));
  expect(open).toHaveBeenCalledOnce();
});
it("does not invent missing contact information", () => {
  render(<StaffingSummaryList people={[{ id: 1, name: "Bob Smith", role: "Gatekeeper", onOpen: vi.fn(), enrollment: "SENT" }]} />);
  expect(screen.getAllByText("—")).toHaveLength(2);
});
