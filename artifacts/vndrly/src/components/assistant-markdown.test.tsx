import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AssistantMarkdown } from "@/components/assistant-markdown";

describe("AssistantMarkdown links", () => {
  it("renders bills-to-pay slug as an internal link", () => {
    render(<AssistantMarkdown text="[Open bills to pay](bills-to-pay)" />);
    const link = screen.getByRole("link", { name: "Open bills to pay" });
    expect(link.getAttribute("href")).toBe("/bills-to-pay");
  });

  it("unwraps bold-wrapped markdown links", () => {
    render(
      <AssistantMarkdown text="**[Open Bills to Pay](/bills-to-pay)**" />,
    );
    expect(screen.getByRole("link", { name: "Open Bills to Pay" })).toBeTruthy();
  });
});
