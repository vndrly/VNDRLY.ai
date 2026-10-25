import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { voice, setMuted } = vi.hoisted(() => {
 const setMuted = vi.fn();
 return {setMuted,voice:{state:"idle",muted:true,availabilityStatus:"available",setMuted}};
});
vi.mock("@/hooks/use-askv-voice-session", () => ({useAskVVoiceSession:()=>voice}));
import AskVStatusIndicator from "./askv-status-indicator";
describe("AskV slider",()=>{
 beforeEach(()=>{setMuted.mockClear();Object.assign(voice,{state:"idle",muted:true,availabilityStatus:"available"});});
 it.each([
 ["idle",true,"available","Muted",false,false],
 ["stopped",false,"available","Muted",false,false],
 ["connecting",false,"available","Connecting",false,true],
 ["listening",false,"available","Active",true,true],
 ["speaking",false,"available","Active",true,true],
 ["wake-idle",false,"available","Active",true,true],
 ["error",false,"available","Unavailable",false,false],
 ["idle",true,"unavailable","Unavailable",false,false],
 ] as const)("keeps voice behavior for %s / %s / %s",(state,muted,availabilityStatus,status,active,nextMute)=>{
 Object.assign(voice,{state,muted,availabilityStatus});
 render(<AskVStatusIndicator placement="top-strip"/>);
 const slider=screen.getByRole("switch",{name:"AskV is "+status});
 expect(slider.getAttribute("aria-checked")).toBe(String(active));
 expect(slider.querySelector(".workday-switch-dot")).not.toBeNull();
 expect(slider.textContent).toBe("");
 expect(screen.getByTestId("askv-audio-trace")).toBeTruthy();
 fireEvent.click(slider);expect(setMuted).toHaveBeenCalledWith(nextMute);
 });
 it("does not open the voice panel and uses the same slider in both placements",()=>{
 const opened=vi.fn();window.addEventListener("askv:open-panel",opened);
 const {rerender}=render(<AskVStatusIndicator placement="top-strip"/>);
 const classes=screen.getByRole("switch").className;
 fireEvent.click(screen.getByRole("switch"));expect(opened).not.toHaveBeenCalled();
 rerender(<AskVStatusIndicator/>);expect(screen.getByRole("switch").className).toBe(classes);
 window.removeEventListener("askv:open-panel",opened);
 });
});
