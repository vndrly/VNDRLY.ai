import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import PickupShiftPill from "./PickupShiftPill";
const request=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/api",()=>({apiFetch:request}));
vi.mock("@/lib/auth",()=>({captureAuthScope:()=>({}),isAuthScopeCurrent:()=>true}));
afterEach(cleanup);
it("saves only Pickup Shifts without changing On Call or duty",async()=>{
  request.mockImplementation(async(_path,init)=>({active:init?.method==="PUT"}));
  render(<PickupShiftPill/>);
  const control=screen.getByRole("switch",{name:"Pickup Shifts"});
  await waitFor(()=>expect(control.getAttribute("aria-disabled")).not.toBe("true"));
  expect(screen.getAllByRole("switch")).toHaveLength(1);fireEvent.click(control);
  await waitFor(()=>expect(control.getAttribute("aria-checked")).toBe("true"));
  expect(request.mock.calls.every(([path])=>path==="/api/native-operations/pickup-shifts")).toBe(true);
});
