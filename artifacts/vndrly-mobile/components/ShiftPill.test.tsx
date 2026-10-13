import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("./LayeredPillButton", () => ({ default: ({ children, disabled, inactive, onPress }: any) => <button disabled={disabled} data-inactive={String(inactive)} onClick={onPress}>{children}</button> }));
import ShiftPill from "./ShiftPill";
afterEach(cleanup);
it("waits for server state rather than changing shift state on a tap", () => {
 const save=vi.fn(); const {rerender}=render(<ShiftPill active={false} disabled={false} label="Start Shift" onPress={save}/>);
 fireEvent.click(screen.getByRole("button")); expect(save).toHaveBeenCalledOnce(); expect(screen.getByRole("button").getAttribute("data-inactive")).toBe("true");
 rerender(<ShiftPill active disabled={false} label="On Shift" onPress={save}/>); expect(screen.getByRole("button").textContent).toBe("On Shift"); expect(screen.getByRole("button").getAttribute("data-inactive")).toBe("false");
});
it("prevents another request while saving",()=>{const save=vi.fn();render(<ShiftPill active disabled label="On Shift" onPress={save}/>);fireEvent.click(screen.getByRole("button"));expect(save).not.toHaveBeenCalled();});
