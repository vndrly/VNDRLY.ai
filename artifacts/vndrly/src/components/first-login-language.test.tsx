import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import FirstLoginLanguage from "./first-login-language";
const state=vi.hoisted(()=>({user:{userId:7,needsLanguageChoice:true,mustChangePassword:false,requiresContextChoice:false},save:vi.fn(),change:vi.fn()}));
vi.mock("@/hooks/use-auth",()=>({useAuth:()=>({user:state.user,setPreferredLanguage:state.save})}));
vi.mock("react-i18next",()=>({useTranslation:()=>({i18n:{changeLanguage:state.change},t:(key:string)=>key})}));
vi.mock("./png-pill-rollover",()=>({PngPillButton:({children,color,...props}:any)=><button {...props}>{children}</button>}));
beforeEach(()=>{
  state.user={userId:7,needsLanguageChoice:true,mustChangePassword:false,requiresContextChoice:false};state.save.mockReset();state.change.mockReset();
  vi.stubGlobal("fetch",vi.fn(async()=>({ok:true})));
});
it.each(["en","es"])("saves %s once before dismissing",async(language)=>{
  render(<FirstLoginLanguage/>);
  expect(screen.getByText(/English is the default/)).toBeTruthy();
  expect(screen.getByRole("combobox",{name:"Language"}).getAttribute("value")??"en").toBe("en");
  expect(screen.getAllByRole("option")).toHaveLength(2);
  fireEvent.change(screen.getByRole("combobox",{name:"Language"}),{target:{value:language}});
  fireEvent.click(screen.getByRole("button",{name:"Continue"}));
  await waitFor(()=>expect(state.save).toHaveBeenCalledWith(language));
  expect(fetch).toHaveBeenCalledWith("/api/auth/me/language",expect.objectContaining({method:"PATCH",body:JSON.stringify({language})}));
  await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());
});
it("does not repeat the prompt after a saved choice or before invitation password acceptance",()=>{
  state.user.needsLanguageChoice=false;
  const view=render(<FirstLoginLanguage/>);expect(screen.queryByRole("dialog")).toBeNull();
  state.user.needsLanguageChoice=true;state.user.mustChangePassword=true;view.rerender(<FirstLoginLanguage/>);
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("does not claim a failed language preference was saved",async()=>{
  vi.mocked(fetch).mockRejectedValue(Error("offline"));render(<FirstLoginLanguage/>);
  fireEvent.change(screen.getByRole("combobox",{name:"Language"}),{target:{value:"es"}});
  fireEvent.click(screen.getByRole("button",{name:"Continue"}));
  await screen.findByRole("alert");expect(state.save).not.toHaveBeenCalled();expect(state.change).not.toHaveBeenCalled();
});
