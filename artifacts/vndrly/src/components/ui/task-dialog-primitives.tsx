import * as React from "react";
import * as Primitive from "@radix-ui/react-dialog";
import {OverlayTaskContext, TaskDialog, useOverlayDraft} from "./overlay-policy";

export const Root = TaskDialog;
export const Trigger = Primitive.Trigger;
export const Close = Primitive.Close;
export const Title = Primitive.Title;
export const Description = Primitive.Description;
export function Portal(props: React.ComponentProps<typeof Primitive.Portal>) {
  const task = React.useContext(OverlayTaskContext);
  return <Primitive.Portal {...props} forceMount={task?.mounted ? true : undefined}/>;
}
export const Overlay = React.forwardRef<React.ElementRef<typeof Primitive.Overlay>, React.ComponentPropsWithoutRef<typeof Primitive.Overlay>>(function Overlay(props, ref) {
  const task = React.useContext(OverlayTaskContext);
  return task && !task.active ? null : <Primitive.Overlay {...props} data-overlay-backdrop="" ref={ref}/>;
});
export const Content = React.forwardRef<React.ElementRef<typeof Primitive.Content>, React.ComponentPropsWithoutRef<typeof Primitive.Content> & {dismissDisabled?:boolean; protectDraft?:boolean}>(function Content({dismissDisabled, protectDraft, ...props}, ref) {
  const draft = useOverlayDraft(dismissDisabled, protectDraft);
  return <Primitive.Content {...props} forceMount={draft.task?.mounted ? true : undefined}
    hidden={draft.task ? !draft.task.active : props.hidden} data-overlay-task=""
    ref={node => {draft.ref.current=node; if(typeof ref === "function") ref(node); else if(ref) ref.current=node;}}
    onFocusCapture={e=>{draft.remember();props.onFocusCapture?.(e);}}
    onPointerDownCapture={e=>{draft.remember();props.onPointerDownCapture?.(e);}}
    onChangeCapture={e=>{draft.changed();props.onChangeCapture?.(e);}}
    onInputCapture={e=>{draft.changed();props.onInputCapture?.(e);}}
    onClickCapture={e=>{draft.click(e);if(!e.defaultPrevented)props.onClickCapture?.(e);}}
    onCloseAutoFocus={e=>{if(draft.task?.requested)e.preventDefault();props.onCloseAutoFocus?.(e);}}
  />;
});
