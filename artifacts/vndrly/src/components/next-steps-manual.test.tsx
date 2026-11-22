import { useEffect, useState } from "react";
import { cleanup, render, screen, waitFor, fireEvent, act, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextStepsNavButton, NextStepsProvider, useNextSteps } from "./next-steps";
import { registerGateHelper, type GateHelperKey } from "@/lib/gate-helper-registry";
import type { AccountNextStepsSummary, NextStepWorkflow } from "@/lib/next-steps-model";
const mocks = vi.hoisted(() => ({
  user: { userId: 7, activeMembershipId: 2, vendorId: 4, role: "vendor", vendorRole: "office", availableMemberships: [{ id: 2, role: "admin" }], managedSubcontractor: undefined as undefined | { siteGrants: { siteId: number; role: "gatekeeper" }[] } },
  navigate: vi.fn(), location: "/", summary: { setup: [], credentials: [], firstWatch: null } as AccountNextStepsSummary,
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("wouter", () => ({ useLocation: () => [mocks.location, mocks.navigate] }));
vi.mock("@/hooks/use-brand", () => ({ useBrand: () => ({ primary: "#187650", name: "Test Company", logoSquareUrl: "/company.png" }) }));
let cache: QueryClient;
const cleanDefinitions: (() => void)[] = [];
const response = (body: unknown, ok = true) => ({ ok, json: async () => structuredClone(body) }) as Response;
beforeEach(() => {
  mocks.user = { userId: 7, activeMembershipId: 2, vendorId: 4, role: "vendor", vendorRole: "office", availableMemberships: [{ id: 2, role: "admin" }], managedSubcontractor: undefined };
  mocks.summary = { setup: [], credentials: [], firstWatch: null };
  mocks.location = "/"; mocks.navigate.mockReset();
  vi.stubGlobal("fetch", vi.fn(async path => response(path === "/api/workflow-helpers/completions" ? { recorded: true, counted: false } : mocks.summary)));
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => { cleanup(); cache.clear(); cleanDefinitions.splice(0).forEach(clean => clean()); vi.unstubAllGlobals(); });
import { useCardNextSteps } from "./card-next-steps";
function Page({title="Edit a gate"}:{title?:string}) {
 useCardNextSteps({card:"page",task:title,enabled:true,title,steps:["Use the saved gate form"],target:null,prompt:"Choose the gate",choices:[{id:"edit",title}]});
 return <><NextStepsNavButton/><button onClick={()=>{}}>Ordinary control</button></>;
}
function View({title}:{title?:string}) {return <QueryClientProvider client={cache}><NextStepsProvider><Page title={title}/></NextStepsProvider></QueryClientProvider>;}
it("opens only explicitly and lists only page how-tos, without account tasks",async()=>{
 render(<View/>);
 await waitFor(()=>expect(screen.getByRole("button",{name:/Next Steps,/})).toBeTruthy());
 expect(screen.queryByTestId("next-steps-panel")).toBeNull();expect(screen.queryByTestId("next-steps-selected-workflow")).toBeNull();
 fireEvent.click(screen.getByText("Ordinary control"));expect(screen.queryByTestId("next-steps-selected-workflow")).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:/Next Steps,/}));
 fireEvent.click(screen.getByRole("button",{name:/^How to edit a gate/}));
 await screen.findByTestId("next-steps-selected-workflow");
 fireEvent.click(screen.getByRole("button",{name:"Stop current helper"}));
 fireEvent.click(screen.getByText("Ordinary control"));expect(screen.queryByTestId("next-steps-selected-workflow")).toBeNull();
});
it("closes guidance and replaces how-tos when the page changes",async()=>{
 const view=render(<View/>);fireEvent.click(screen.getByRole("button",{name:/Next Steps,/}));await screen.findByText("How to edit a gate");
 mocks.location="/gate/map";view.rerender(<View title="Use the map"/>);
 await waitFor(()=>expect(screen.queryByTestId("next-steps-panel")).toBeNull());
 fireEvent.click(screen.getByRole("button",{name:/Next Steps,/}));
 expect(await screen.findByText("How to use the map")).toBeTruthy();expect(screen.queryByText("How to edit a gate")).toBeNull();
});
