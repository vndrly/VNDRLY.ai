import * as React from "react";
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PublicAskV from "./public-askv";

afterEach(cleanup);

it("presents the public assistant as a product guide with no account authority", async () => {
  const user = userEvent.setup();
  render(<PublicAskV />);

  await user.click(screen.getByRole("button", { name: /ask v.*product guide/i }));

  expect(screen.getByRole("dialog", { name: /ask v.*product guide/i })).toBeTruthy();
  expect(screen.getByText(/public product information only/i)).toBeTruthy();
  expect(screen.getByText(/cannot access accounts or perform operational actions/i)).toBeTruthy();
});
