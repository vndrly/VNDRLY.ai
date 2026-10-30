import {useRef,useState} from "react";
import {cleanup,fireEvent,render,screen,within,waitFor} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({back:vi.fn(),navigate:vi.fn()}));
vi.mock("wouter",()=>({useLocation:()=>["/gate/map",mocks.navigate]}));
vi.mock("@/lib/in-app-navigation",()=>({navigateBackInApp:mocks.back}));
vi.mock("react-i18next",()=>({useTranslation:()=>({t:(key:string,options:any)=>options?.defaultValue??key})}));
import {MobilePageHeader} from "./mobile-page-header";
function Page({title="Gate Map",withActions=false}:{title?:string;withActions?:boolean}){
 const ref=useRef<HTMLElement>(null),[open,setOpen]=useState(false);
 return <><MobilePageHeader contentRef={ref} fallbackTitle="Gate" sidebarOpen={open} onToggleMenu={()=>setOpen(value=>!value)}/><main ref={ref}><header data-testid="original-header"><a data-testid="button-back" href="/gate">Original back</a><svg/><h1 data-testid="original-title">{title}</h1>{withActions&&<button>Export</button>}</header><section role="dialog"><h1>Dialog title</h1></section></main></>;
}
afterEach(()=>{cleanup();vi.clearAllMocks();});
it("keeps the page title with separate branded back and navigation controls",()=>{
 render(<Page/>);
 const header=screen.getByLabelText("Page navigation");
 expect(within(header).getByRole("heading",{name:"Gate Map"})).toBeTruthy();
 const menu=screen.getByRole("button",{name:"Toggle navigation"});
 expect(menu.getAttribute("aria-expanded")).toBe("false");fireEvent.click(menu);expect(menu.getAttribute("aria-expanded")).toBe("true");fireEvent.click(menu);expect(menu.getAttribute("aria-expanded")).toBe("false");
 expect(mocks.back).not.toHaveBeenCalled();fireEvent.click(within(header).getByRole("button",{name:"Back"}));expect(mocks.back).toHaveBeenCalledWith(mocks.navigate,"/gate");
 expect(menu.querySelector('[data-testid="sphere-button-overlay"] svg')).toBeTruthy();
 expect(screen.getByTestId("original-header").hasAttribute("data-mobile-source-empty")).toBe(true);
});
it("follows changing page names without removing header actions or dialog headings",async()=>{
 const view=render(<Page withActions/>);
 expect(screen.getByTestId("original-header").hasAttribute("data-mobile-source-empty")).toBe(false);
 expect(screen.getByRole("button",{name:"Export"})).toBeTruthy();
 view.rerender(<Page title="Gate Log" withActions/>);
 await waitFor(()=>expect(within(screen.getByLabelText("Page navigation")).getByRole("heading",{name:"Gate Log"})).toBeTruthy());
 expect(screen.getByRole("heading",{name:"Dialog title"}).hasAttribute("data-mobile-source-title")).toBe(false);
});
it("also provides navigation for pages that have a title without an existing back control",()=>{
 function Plain(){const ref=useRef<HTMLElement>(null);return <><MobilePageHeader contentRef={ref} fallbackTitle="Dashboard" sidebarOpen={false} onToggleMenu={()=>{}}/><main ref={ref}><h1>Reports</h1><button>Download</button></main></>;}
 render(<Plain/>);expect(within(screen.getByLabelText("Page navigation")).getByRole("heading",{name:"Reports"})).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:"Back"}));expect(mocks.back).toHaveBeenCalledWith(mocks.navigate,"/");
 expect(screen.getByRole("button",{name:"Download"})).toBeTruthy();
});
