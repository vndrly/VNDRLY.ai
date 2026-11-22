import React, {useState} from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import DismissibleModal from "./DismissibleModal";
import { Alert } from "react-native";
import { ModalTextInput, ModalPressable } from "./ModalDraft";
import { overlayOwner, setWebOverlayOwner } from "@/lib/overlay-owner";
afterEach(cleanup);
it("protects picker-only drafts as well as typed text",()=>{
 const alert=vi.spyOn(Alert,'alert').mockImplementation(()=>{}),close=vi.fn();
 function Form(){const[value,setValue]=useState('First');return <DismissibleModal visible draftValue={value} onRequestClose={close}><ModalPressable onPress={()=>setValue('Second')}>Choose second</ModalPressable></DismissibleModal>}
 const view=render(<Form/>);fireEvent.click(view.getByText('Choose second'));fireEvent.click(view.getByTestId('modal-safe-close'));expect(alert).toHaveBeenCalledOnce();expect(close).not.toHaveBeenCalled();alert.mockRestore();
});
it("guards edited native text and custom Cancel buttons without erasing the draft", () => {
 const alert=vi.spyOn(Alert,"alert").mockImplementation(()=>{}), close=vi.fn();
 const view=render(<DismissibleModal visible onRequestClose={close}><ModalTextInput accessibilityLabel="Draft" defaultValue="Original"/><ModalPressable onPress={close}>Cancel editing</ModalPressable></DismissibleModal>);
 fireEvent.change(view.getByLabelText("Draft"),{target:{value:"Keep this"}});
 fireEvent.click(view.getByText("Cancel editing"));expect(alert).toHaveBeenCalledOnce();expect(close).not.toHaveBeenCalled();
 expect((view.getByLabelText("Draft") as HTMLInputElement).value).toBe("Keep this");
 const actions=alert.mock.calls[0][2]!;actions.find(action=>action.style==="destructive")!.onPress!();expect(close).toHaveBeenCalledOnce();alert.mockRestore();
});
it("holds native presentation until an embedded web task releases ownership",()=>{
 setWebOverlayOwner('test',true);const release=overlayOwner.claim('native');expect(overlayOwner.current()).toBe('web:test');
 setWebOverlayOwner('test',false);expect(overlayOwner.current()).toBe('native');release();expect(overlayOwner.current()).toBeUndefined();
});
it("uses one native presentation for a related step and retains the parent's draft",()=>{
 function Form(){const[child,setChild]=useState(false),[text,setText]=useState('Draft');return <DismissibleModal visible onRequestClose={()=>{}}><ModalTextInput accessibilityLabel="Parent draft" value={text} onChangeText={setText}/><ModalPressable onPress={()=>setChild(true)}>Open details</ModalPressable><DismissibleModal visible={child} onRequestClose={()=>setChild(false)}><span>Related details</span></DismissibleModal></DismissibleModal>}
 const view=render(<Form/>);fireEvent.change(view.getByLabelText('Parent draft'),{target:{value:'Preserve'}});fireEvent.click(view.getByText('Open details'));
 expect(view.getByText('Related details')).toBeTruthy();fireEvent.click(view.getByRole('button',{name:'Cancel'}));expect((view.getByLabelText('Parent draft') as HTMLInputElement).value).toBe('Preserve');
});
it("offers two explicit dismiss controls without invoking content actions", () => {
 const dismiss=vi.fn(), submit=vi.fn();
 const view=render(<DismissibleModal visible onRequestClose={dismiss}><button onClick={submit}>Submit</button></DismissibleModal>);
 fireEvent.click(view.getByTestId("modal-safe-close"));
 fireEvent.click(view.getByTestId("modal-safe-cancel"));
 expect(dismiss).toHaveBeenCalledTimes(2); expect(submit).not.toHaveBeenCalled();
});
it("blocks both exits only while the caller's operation is pending", () => {
 const dismiss=vi.fn(); const view=render(<DismissibleModal visible dismissDisabled onRequestClose={dismiss}/>);
 fireEvent.click(view.getByTestId("modal-safe-close")); fireEvent.click(view.getByTestId("modal-safe-cancel"));
 expect(dismiss).not.toHaveBeenCalled();
 view.rerender(<DismissibleModal visible onRequestClose={dismiss}/>);
 fireEvent.click(view.getByTestId("modal-safe-cancel"));expect(dismiss).toHaveBeenCalledOnce();
});
it("makes a required account exit explicitly sign out", () => {
 const signOut=vi.fn();const view=render(<DismissibleModal visible dismissLabel="signOut" onRequestClose={signOut}/>);
 expect(view.getByTestId("modal-safe-cancel").getAttribute("aria-label")).toBe("Sign out");
 fireEvent.click(view.getByTestId("modal-safe-cancel"));expect(signOut).toHaveBeenCalledOnce();
});

it("uses a caller's single close control without adding duplicate chrome, and keeps the draft guard",()=>{
 const alert=vi.spyOn(Alert,"alert").mockImplementation(()=>{}),close=vi.fn();
 const view=render(<DismissibleModal visible contentHasCloseControl onRequestClose={close}><ModalTextInput accessibilityLabel="Custom draft" defaultValue="Original"/><ModalPressable accessibilityRole="button" accessibilityLabel="Close picker" onPress={close}>×</ModalPressable></DismissibleModal>);
 expect(view.queryByTestId("modal-safe-close")).toBeNull();expect(view.queryByTestId("modal-safe-cancel")).toBeNull();
 fireEvent.change(view.getByLabelText("Custom draft"),{target:{value:"Preserve this"}});
 fireEvent.click(view.getByRole("button",{name:"Close picker"}));expect(alert).toHaveBeenCalledOnce();expect(close).not.toHaveBeenCalled();
 expect((view.getByLabelText("Custom draft") as HTMLInputElement).value).toBe("Preserve this");alert.mockRestore();
});
