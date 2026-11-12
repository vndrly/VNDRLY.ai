import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ scope: "user:7:vendor:2", selected: null, showCardGuide: vi.fn(() => true), stopHelper: vi.fn() }));
vi.mock("./next-steps", () => ({ useNextSteps: () => mock }));
vi.mock("./guided-target", () => ({ useGuidedTarget: vi.fn() }));
import { cardPromptKey, useCardNextSteps } from "./card-next-steps";
function Card({ enabled = true, task = "edit" }: { enabled?: boolean; task?: string }) {
 const guide = useCardNextSteps({card:"gates",task,enabled,title:"Edit gate",steps:["Use the real form"],target:"name",prompt:"Choose the gate"});
 return <><button onClick={() => guide.begin()}>Use card</button><button onClick={() => guide.begin(true)}>Help</button></>;
}
beforeEach(() => {localStorage.clear();vi.clearAllMocks();mock.scope="user:7:vendor:2";mock.showCardGuide.mockReturnValue(true);});
afterEach(cleanup);
it("opens automatically on the first three visits, once per visit, and stays available manually", () => {
 for(let visit=0;visit<4;visit++) { const view=render(<Card/>);fireEvent.click(screen.getByText("Use card"));fireEvent.click(screen.getByText("Use card"));view.unmount(); }
 expect(mock.showCardGuide).toHaveBeenCalledTimes(3);
 render(<Card/>);fireEvent.click(screen.getByText("Help"));expect(mock.showCardGuide).toHaveBeenCalledTimes(4);
 expect(localStorage.getItem(cardPromptKey(mock.scope,"gates","edit"))).toBe("3");
});
it("isolates counters by actor/company and workflow", () => {
 localStorage.setItem(cardPromptKey(mock.scope,"gates","edit"),"3");
 const view=render(<Card task="create"/>);fireEvent.click(screen.getByText("Use card"));view.unmount();
 mock.scope="user:8:vendor:2";render(<Card/>);fireEvent.click(screen.getByText("Use card"));expect(mock.showCardGuide).toHaveBeenCalledTimes(2);
});
it("does not offer unauthorized controls or count a rejected opening", () => {
 const view=render(<Card enabled={false}/>);fireEvent.click(screen.getByText("Help"));expect(mock.showCardGuide).not.toHaveBeenCalled();view.unmount();
 mock.showCardGuide.mockReturnValue(false);render(<Card/>);fireEvent.click(screen.getByText("Use card"));expect(localStorage.getItem(cardPromptKey(mock.scope,"gates","edit"))).toBeNull();
});
it("does not execute any action and leaves manual help available when storage is blocked", () => {
 const spy=vi.spyOn(Storage.prototype,"getItem").mockImplementation(() => {throw Error("blocked");});
 try {render(<Card/>);fireEvent.click(screen.getByText("Use card"));expect(mock.showCardGuide).not.toHaveBeenCalled();fireEvent.click(screen.getByText("Help"));expect(mock.showCardGuide).toHaveBeenCalledWith(expect.objectContaining({kind:"card-guide",action:null}));} finally {spy.mockRestore();}
});
