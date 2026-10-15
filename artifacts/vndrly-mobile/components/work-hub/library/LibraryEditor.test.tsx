import React from "react";
import {render,screen,fireEvent,cleanup} from "@testing-library/react";
import {vi,it,expect,afterEach} from "vitest";
import en from "@/lib/locales/en.json";
vi.mock("expo-crypto",()=>({randomUUID:()=>"10000000-0000-4000-8000-000000000001"}));
vi.mock("@/hooks/useColors",()=>({useColors:()=>({})}));
vi.mock("react-i18next",()=>({useTranslation:()=>({t:(key:string)=>key.split('.').reduce((value:any,k)=>value?.[k],en)??key})}));
vi.mock("../../TogglePillButton",()=>({default:({children,onPress,disabled}:any)=><button disabled={disabled} onClick={onPress}>{children}</button>}));
vi.mock("react-native",()=>({Platform:{OS:"web"},Switch:({accessibilityLabel,value,onValueChange,disabled}:any)=><input type="checkbox" aria-label={accessibilityLabel} checked={value} disabled={disabled} onChange={e=>onValueChange(e.target.checked)}/>,View:({children}:any)=><div>{children}</div>,Text:({children}:any)=><span>{children}</span>,TextInput:({value,onChangeText,accessibilityLabel}:any)=><input aria-label={accessibilityLabel} value={value} onChange={e=>onChangeText(e.target.value)}/> }));
import LibraryEditor from "./LibraryEditor";
afterEach(cleanup);
it("saves only a draft and retains a 30-day relative deadline",async()=>{
 const save=vi.fn(async()=>{});render(<LibraryEditor onSave={save}/>);
 fireEvent.change(screen.getByLabelText("Title"),{target:{value:"Orientation policy"}});
 fireEvent.change(screen.getByLabelText("Policy text"),{target:{value:"Approved policy text supplied by the company."}});
 fireEvent.click(screen.getByText("Save draft"));
 expect(save).toHaveBeenCalledWith(expect.objectContaining({kind:"policy",title:"Orientation policy",dueHours:720}));
 expect(screen.queryByText("Publish")).toBeNull();
});
it("rejects a quiz without questions before saving",async()=>{
 const save=vi.fn(async()=>{});render(<LibraryEditor onSave={save}/>);
 fireEvent.change(screen.getByLabelText("Title"),{target:{value:"Orientation"}});
 fireEvent.click(screen.getByText("Training"));fireEvent.click(screen.getByText("Quiz"));fireEvent.click(screen.getByText("Save draft"));
 expect(save).not.toHaveBeenCalled();expect(screen.getByText(/Quiz questions required/)).toBeTruthy();
});
