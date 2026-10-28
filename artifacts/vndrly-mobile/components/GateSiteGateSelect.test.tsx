import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const env = vi.hoisted(() => ({ ipad: false, request: vi.fn() }));
vi.mock("react-native", async importOriginal => { const native = await importOriginal<typeof import("react-native")>(); return { ...native, Platform: { ...native.Platform, OS: "ios", get isPad() { return env.ipad; } }, useWindowDimensions: () => ({ width: 600, height: 900, scale: 1, fontScale: 1 }) }; });
vi.mock("react-native-svg", () => ({default: ({children}: any) => <svg>{children}</svg>, Defs: ({children}: any) => <defs>{children}</defs>, LinearGradient: ({children}: any) => <linearGradient>{children}</linearGradient>, Stop: () => null, Path: () => null}));
vi.mock("@/lib/change-over-api", () => ({ changeOverRequest: env.request }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 1, vendorId: 2 } }) }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ foreground: "white", primary: "orange", card: "black" }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key === "changeOver.site" ? "Site" : key === "changeOver.gate" ? "Gate" : key }) }));
import GateSiteGateSelect from "./GateSiteGateSelect";
afterEach(cleanup);
it.each([[false,170],[true,375]])("uses the device's phone/tablet size rather than orientation (%s)", async (ipad, width) => {
  env.ipad = ipad as boolean;
  env.request.mockResolvedValue({gates:[{id:"a",siteId:1,name:"East"},{id:"b",siteId:2,name:"West"}]});
  const change = vi.fn();
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}})}>
    <GateSiteGateSelect sites={[{id:1,name:"Site A"},{id:2,name:"Site B"}]} siteId={1} gate={{id:"a",name:"East"}} onChange={change}/>
  </QueryClientProvider>);
  expect(screen.getByTestId("site-gate-control").style.width).toBe(`${width}px`);
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("site-gate-selector"));
  fireEvent.click(await screen.findByText("Site B | West"));
  expect(change).toHaveBeenCalledWith(2,"b");
});
