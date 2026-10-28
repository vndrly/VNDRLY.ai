import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { GateTrafficRecord } from "./gate-traffic-record";

it("keeps flags in the bottom strip and the checkout action separate from opening a record", () => {
  const open = vi.fn(), checkout = vi.fn();
  render(<GateTrafficRecord name="Driver" status="On Site" onOpen={open} flags={[
    { key: "unavailable", label: "Location Flag: No GPS" },
    { key: "overdue", label: "Location Flag: Duration Time On Site 05:23 Overdue" },
  ]} action={<button onClick={checkout}>Check Out</button>} />);
  const flag = screen.getByText("Location Flag: Duration Time On Site 05:23 Overdue");
  expect(flag.closest(".gate-traffic-footer")).toBeTruthy();
  expect(flag.closest("button")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Check Out" }));
  expect(checkout).toHaveBeenCalledOnce();
  expect(open).not.toHaveBeenCalled();
});
