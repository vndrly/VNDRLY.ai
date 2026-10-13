import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/hooks/use-brand", () => ({ useBrand: () => ({ primary: "#16abb8", name: "MidCon" }) }));
vi.mock("./SplitToggleHalf", () => ({ default: ({ children, onPress, disabled, accessibilityState }: any) => <button disabled={disabled} aria-pressed={accessibilityState?.selected} onClick={onPress}>{children}</button> }));
import BrandedWorkToggle from "./BrandedWorkToggle";
afterEach(cleanup);
it("keeps shift and on-call actions independent and waits for canonical state", () => {
  const shift = vi.fn(), call = vi.fn();
  render(<><BrandedWorkToggle active={false} onLabel="Start Shift" offLabel="End Shift" disabled={false} onChange={shift} /><BrandedWorkToggle active={false} onLabel="On Call" offLabel="Off Call" disabled={false} onChange={call} /></>);
  fireEvent.click(screen.getByRole("button", { name: "On Call" }));
  expect(call).toHaveBeenCalledWith(true); expect(shift).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Off Call" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Start Shift" }));
  expect(shift).toHaveBeenCalledWith(true);
  fireEvent.click(screen.getByRole("button", { name: "End Shift" }));
  expect(shift).toHaveBeenCalledTimes(1);
});
it("blocks additional changes while an action is being saved", () => {
  const save = vi.fn();
  render(<BrandedWorkToggle active={true} onLabel="On Call" offLabel="Off Call" disabled onChange={save} />);
  fireEvent.click(screen.getByRole("button", { name: "Off Call" })); expect(save).not.toHaveBeenCalled();
});
