import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import FirstLoginLanguage from "./FirstLoginLanguage";
const state=vi.hoisted(()=>({user:{id:7,needsLanguageChoice:true,mustChangePassword:false},save:vi.fn()}));
vi.mock("@/hooks/use-auth",()=>({useAuth:()=>({user:state.user,requiresContextChoice:false})}));
vi.mock("@/hooks/use-brand",()=>({useBrand:()=>({primary:"#00a6b2"})}));
vi.mock("@/lib/api",()=>({updatePreferredLanguage:state.save}));
vi.mock("@/components/TogglePillButton",()=>({default:({children,onPress,disabled}:any)=><button onClick={onPress} disabled={disabled}>{children}</button>}));
afterEach(cleanup);
beforeEach(()=>{state.user={id:7,needsLanguageChoice:true,mustChangePassword:false};state.save.mockReset();state.save.mockResolvedValue(undefined);});
it.each([["English","en"],["Español","es"]])("saves the first-login %s choice",async(label,language)=>{
  render(<FirstLoginLanguage/>);fireEvent.click(screen.getByRole("combobox",{name:"Language"}));
  fireEvent.click(screen.getByRole("button",{name:label}));
  fireEvent.click(screen.getByRole("button",{name:"Continue"}));
  await waitFor(()=>expect(state.save).toHaveBeenCalledWith(language));
  await waitFor(()=>expect(screen.queryByText("Choose your language")).toBeNull());
});
it("does not prompt after a saved choice",()=>{
  state.user.needsLanguageChoice=false;render(<FirstLoginLanguage/>);
  expect(screen.queryByText("Choose your language")).toBeNull();
});
