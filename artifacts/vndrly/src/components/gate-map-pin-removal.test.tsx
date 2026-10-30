import { cleanup,fireEvent,render,screen } from "@testing-library/react";
import { afterEach,expect,it,vi } from "vitest";
import { GateMapPinRemoval } from "./gate-map-pin-removal";

afterEach(cleanup);
it("requires confirmation and lets Cancel leave the shared pin unchanged",()=>{
  const remove=vi.fn().mockResolvedValue(undefined);
  render(<GateMapPinRemoval es={false} pending={false} onRemove={remove}/>);
  fireEvent.click(screen.getByRole("button",{name:"Remove Pin"}));
  expect(screen.getByRole("alert").textContent).toContain("everyone in your company");
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Cancel"}));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Remove Pin"}));
  fireEvent.click(screen.getByRole("button",{name:"Yes, remove"}));
  expect(remove).toHaveBeenCalledTimes(1);
});
