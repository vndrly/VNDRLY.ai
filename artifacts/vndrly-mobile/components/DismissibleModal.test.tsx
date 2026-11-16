import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import DismissibleModal from "./DismissibleModal";
afterEach(cleanup);
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
