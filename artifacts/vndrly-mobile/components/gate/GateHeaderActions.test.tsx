import React, { useEffect } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import GateHeaderActions, { GateHeaderActionsProvider, useGateHeaderActions } from "./GateHeaderActions";

vi.mock("@expo/vector-icons", () => ({ Feather: () => null }));
vi.mock("@/hooks/use-brand", () => ({ useBrand: () => ({ primary: "#00a8b8" }) }));
afterEach(cleanup);

it("opens guidance on the registered page and clears it when the page leaves", () => {
  const open = vi.fn(), notifications = vi.fn();
  function Page() {
    const header = useGateHeaderActions()!;
    useEffect(() => {
      const unregister = header.register(open);
      header.update({ enabled: true, count: 2, open: false });
      return unregister;
    }, [header.register, header.update]);
    return null;
  }
  const ui = (page: boolean) => <GateHeaderActionsProvider><GateHeaderActions count={4} onNotifications={notifications} />{page && <Page />}</GateHeaderActionsProvider>;
  const screen = render(ui(true));
  fireEvent.click(screen.getByRole("button", { name: "Next Steps" }));
  expect(open).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByTestId("notification-bell"));
  expect(notifications).toHaveBeenCalledOnce();
  screen.rerender(ui(false));
  expect(screen.queryByRole("button", { name: "Next Steps" })).toBeNull();
});
