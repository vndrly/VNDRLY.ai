import React,{useState} from "react";
import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {Dialog,DialogContent,DialogTitle} from "./dialog";
vi.mock("@/hooks/use-auth",()=>({useAuth:()=>({user:null})}));
vi.mock("@workspace/api-client-react",()=>({useGetPartner:()=>({}),useGetVendor:()=>({}),getGetPartnerQueryKey:()=>[],getGetVendorQueryKey:()=>[]}));
vi.mock("react-i18next",()=>({useTranslation:()=>({t:(_:string,o:any)=>o?.defaultValue})}));
afterEach(cleanup);
it.each(["Close","Cancel"])("dismisses using %s without triggering the form action",name=>{
 const save=vi.fn();function Demo(){const[open,setOpen]=useState(true);return <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogTitle>Edit</DialogTitle><button onClick={save}>Save</button></DialogContent></Dialog>}
 render(<Demo/>);fireEvent.click(screen.getByRole("button",{name}));expect(screen.queryByRole("dialog")).toBeNull();expect(save).not.toHaveBeenCalled();
});
it("disables safe exits during a guarded write",()=>{
 const close=vi.fn();render(<Dialog open onOpenChange={close}><DialogContent dismissDisabled><DialogTitle>Saving</DialogTitle></DialogContent></Dialog>);
 fireEvent.click(screen.getByRole("button",{name:"Cancel"}));fireEvent.click(screen.getByRole("button",{name:"Close"}));expect(close).not.toHaveBeenCalled();
});
