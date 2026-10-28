import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GateReportToolbar } from "./gate-report-toolbar";
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 1 } }) }));
const filters = {siteId:42,range:"7d" as const,recordType:"all" as const};
const BrowserURL = URL;
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it.each(["pdf","excel","word"])("starts the %s download when its dropdown option is selected", async format => {
  const fetcher = vi.fn().mockResolvedValue({ok:true,blob:async()=>new Blob(["report"])});
  vi.stubGlobal("fetch",fetcher);
  const release = vi.fn();
  vi.stubGlobal("URL",class extends BrowserURL {static createObjectURL(){return "blob:test";} static revokeObjectURL=release;});
  vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(()=>{});
  render(<GateReportToolbar dropdown reportKind="history" filters={filters}/>);
  fireEvent.change(screen.getByRole("combobox",{name:"Export"}),{target:{value:format}});
  await waitFor(()=>expect(release).toHaveBeenCalledWith("blob:test"));
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({reportKind:"history",format,filters});
});
it("opens the existing recipient chooser for Email without sending anything", async () => {
  const fetcher = vi.fn().mockResolvedValue({ok:true,json:async()=>({recipients:[{userId:1,name:"Me",role:"office",scope:"site"}]})});
  vi.stubGlobal("fetch",fetcher);
  render(<GateReportToolbar dropdown reportKind="history" filters={filters}/>);
  fireEvent.change(screen.getByRole("combobox",{name:"Export"}),{target:{value:"email"}});
  await screen.findByRole("checkbox");
  expect(fetcher.mock.calls.every(([,init])=>!init?.method)).toBe(true);
  expect(screen.getByRole("button",{name:"Send secure link"})).toBeTruthy();
});
