import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({ primary: "#00adb5", name: "MidCon" }),
}));

import TogglePillButton from "./TogglePillButton";

afterEach(cleanup);

describe("TogglePillButton accessibility", () => {
  it("exposes its native button name and selected state", () => {
    render(
      <TogglePillButton accessibilityState={{ selected: true }}>
        Summary
      </TogglePillButton>,
    );

    const button = screen.getByRole("button", { name: "Summary" });
    expect(button.getAttribute("aria-selected")).toBe("true");
    expect(button.getAttribute("aria-busy")).toBe("false");
    expect(button.getAttribute("aria-disabled")).not.toBe("true");
  });

  it("retains a named destructive action while its loading spinner is busy and disabled", () => {
    render(
      <TogglePillButton accessibilityLabel="Remove Bob Brand" color="red" loading>
        Remove Bob Brand
      </TogglePillButton>,
    );

    const button = screen.getByRole("button", { name: "Remove Bob Brand" });
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(screen.queryByText("Remove Bob Brand")).toBeNull();
  });

  it("honors requested minimum sizing and never clips multiline Dynamic Type labels", () => {
    render(<TogglePillButton height={56}>A deliberately long translated action label</TogglePillButton>);
    const button = screen.getByRole("button", { name: "A deliberately long translated action label" });
    expect(button.style.minHeight).toBe("56px");
    expect(button.style.height).toBe("");
    const label = screen.getByText("A deliberately long translated action label");
    expect(label.style.whiteSpace).not.toBe("nowrap");
  });

  it("provides at least a 44 point target by default", () => {
    render(<TogglePillButton>Send</TogglePillButton>);
    expect(screen.getByRole("button", { name: "Send" }).style.minHeight).toBe("44px");
  });
});
