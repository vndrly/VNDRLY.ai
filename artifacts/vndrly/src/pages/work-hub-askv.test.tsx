import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AskVWorkspace } from "./work-hub";

vi.mock("@/components/assistant-panel", () => ({
  AssistantPanel: ({ embedded }: { embedded?: boolean }) => (
    <div data-testid="embedded-askv" data-embedded={String(embedded)}>
      <div>Conversation history</div>
      <textarea aria-label="Ask V message" />
      <button>Speak to AskV</button>
    </div>
  ),
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: null }) }));

describe("Work Hub Ask V", () => {
  it("embeds the full conversation surface without an open-side-panel action", () => {
    render(<AskVWorkspace />);
    expect(screen.getByTestId("embedded-askv").getAttribute("data-embedded")).toBe("true");
    expect(screen.getByText("Conversation history")).toBeTruthy();
    expect(screen.getByLabelText("Ask V message")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Speak to AskV" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open AskV" })).toBeNull();
  });
});
