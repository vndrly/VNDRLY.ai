import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCardNextSteps } from "./card-next-steps";

const mock = vi.hoisted(() => ({
  selected: null,
  showCardGuide: vi.fn(),
  stopHelper: vi.fn(),
  registerPageHelp: vi.fn(),
}));
vi.mock("./next-steps", () => ({ useNextSteps: () => mock }));
vi.mock("./guided-target", () => ({ useGuidedTarget: vi.fn() }));

function Card({ enabled = true, task = "edit" }: { enabled?: boolean; task?: string }) {
  const guide = useCardNextSteps({
    card: "gates", task, enabled, title: "Edit gate", steps: ["Use the real form"],
    target: "name", prompt: "Choose the gate", choices: [{ id: "edit", title: "Edit gate" }],
  });
  return <button data-guidance-scope={guide.scopeId}>Use card</button>;
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

it("leaves guidance closed during card interactions and opens the selected menu workflow", () => {
  const view = render(<Card />);
  fireEvent.focus(screen.getByRole("button"));
  fireEvent.pointerDown(screen.getByRole("button"));
  fireEvent.click(screen.getByRole("button"));
  view.rerender(<Card task="create" />);
  expect(mock.showCardGuide).not.toHaveBeenCalled();
  const [, choices] = mock.registerPageHelp.mock.lastCall!;
  act(() => choices[0].start());
  expect(mock.showCardGuide).toHaveBeenCalledOnce();
  expect(mock.showCardGuide).toHaveBeenCalledWith(expect.objectContaining({ kind: "card-guide", action: null }));
});

it("does not register workflows for unavailable controls", () => {
  render(<Card enabled={false} />);
  expect(mock.registerPageHelp).not.toHaveBeenCalled();
  expect(mock.showCardGuide).not.toHaveBeenCalled();
});
