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

  it("honors an explicitly requested taller pill", () => {
    render(<TogglePillButton height={56}>A deliberately long translated action label</TogglePillButton>);
    const button = screen.getByRole("button", { name: "A deliberately long translated action label" });
    expect(button.style.height).toBe("56px");
  });

  it("renders the shared VNDRLY pill at the canonical compact height", () => {
    render(<TogglePillButton>Send</TogglePillButton>);
    const button = screen.getByRole("button", { name: "Send" });
    expect(button.style.height).toBe("30px");
    expect(button.style.minHeight).toBe("");
  });
});
