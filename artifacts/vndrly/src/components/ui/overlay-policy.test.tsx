import React, {useState} from "react";
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, expect, it, vi} from "vitest";
import {Dialog, DialogContent, DialogTitle} from "./dialog";
import {createOverlayQueue} from "@/lib/overlay-policy";
import * as CustomDialog from "./task-dialog-primitives";
vi.mock("@/hooks/use-auth",()=>({useAuth:()=>({user:null})}));
vi.mock("@workspace/api-client-react",()=>({useGetPartner:()=>({}),useGetVendor:()=>({}),getGetPartnerQueryKey:()=>[],getGetVendorQueryKey:()=>[]}));
vi.mock("react-i18next",()=>({useTranslation:()=>({t:(_:string,o:any)=>o?.defaultValue})}));
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it("does not discard a task when its accompanying guidance closes",()=>{
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(false), closeHelp=vi.fn();
 render(<Dialog open><DialogContent><DialogTitle>Task</DialogTitle><input aria-label="Task draft"/><div data-guidance-surface><input aria-label="AskV draft"/><button onClick={closeHelp}>Close guidance</button></div></DialogContent></Dialog>);
 fireEvent.focus(screen.getByLabelText('Task draft'));fireEvent.change(screen.getByLabelText('Task draft'),{target:{value:'Unsaved'}});
 fireEvent.click(screen.getByText('Close guidance'));expect(closeHelp).toHaveBeenCalledOnce();expect(confirm).not.toHaveBeenCalled();expect(screen.getByRole('dialog')).toBeTruthy();
});
it("protects drafts in custom map flyouts when their own close button is used",()=>{
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(false),close=vi.fn();
 render(<CustomDialog.Root open><CustomDialog.Portal><CustomDialog.Overlay/><CustomDialog.Content aria-describedby={undefined}><CustomDialog.Title>Gate</CustomDialog.Title><input aria-label="Gate name"/><button onClick={close}>Close gate</button></CustomDialog.Content></CustomDialog.Portal></CustomDialog.Root>);
 fireEvent.focus(screen.getByLabelText('Gate name'));fireEvent.change(screen.getByLabelText('Gate name'),{target:{value:'Draft'}});fireEvent.click(screen.getByText('Close gate'));
 expect(confirm).toHaveBeenCalledOnce();expect(close).not.toHaveBeenCalled();
});
it("queues unrelated tasks and resumes the parent after a related step",()=>{
 const q=createOverlayQueue(); const a=q.register('a',null),b=q.register('b',null);
 expect(q.current()).toBe('a'); const child=q.register('child','a');expect(q.current()).toBe('child');
 child();expect(q.current()).toBe('a');a();expect(q.current()).toBe('b');b();expect(q.current()).toBeNull();
});
it("keeps edited input when dismissal is declined, and closes only after discard",async()=>{
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
 function Form(){const[open,setOpen]=useState(true);return <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogTitle>Edit role</DialogTitle><input aria-label="Role" defaultValue="Gatekeeper"/></DialogContent></Dialog>}
 render(<Form/>);const input=screen.getByLabelText('Role');fireEvent.focus(input);fireEvent.change(input,{target:{value:'Supervisor'}});
 fireEvent.click(screen.getByRole('button',{name:'Cancel'}));expect(confirm).toHaveBeenCalledOnce();expect((input as HTMLInputElement).value).toBe('Supervisor');expect(screen.getByRole('dialog')).toBeTruthy();
 confirm.mockReturnValue(true);fireEvent.click(screen.getByRole('button',{name:'Cancel'}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
});
it("preserves a parent's local form state while a child task owns interaction",async()=>{
 function Editor(){const[value,setValue]=useState('Draft');const[child,setChild]=useState(false);return <><input aria-label="Draft" value={value} onChange={e=>setValue(e.target.value)}/><button onClick={()=>setChild(true)}>Details</button><Dialog open={child} onOpenChange={setChild}><DialogContent><DialogTitle>Details</DialogTitle></DialogContent></Dialog></>}
 render(<Dialog open><DialogContent><DialogTitle>Parent</DialogTitle><Editor/></DialogContent></Dialog>);
 fireEvent.change(screen.getByLabelText('Draft'),{target:{value:'Keep me'}});fireEvent.click(screen.getByRole('button',{name:'Details'}));
 await waitFor(()=>expect(screen.getAllByRole('dialog')).toHaveLength(1));expect(screen.getByRole('dialog').textContent).toContain('Details');
 fireEvent.click(screen.getByRole('button',{name:'Cancel'}));await waitFor(()=>expect((screen.getByLabelText('Draft') as HTMLInputElement).value).toBe('Keep me'));
});
