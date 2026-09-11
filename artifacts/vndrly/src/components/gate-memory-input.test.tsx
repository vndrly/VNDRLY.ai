import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GateMemoryInput } from "./gate-memory-input";

const suggestions = [
  { id: "one", label: "John Mark", detail: "Acme · TX ABC123" },
  { id: "two", label: "Jane Doe", detail: "Acme · OK XYZ789" },
] as any;

describe("GateMemoryInput accessibility", () => {
  it("exposes an associated required combobox and tracks its active listbox option", () => {
    render(<><label htmlFor="driver">Driver</label><GateMemoryInput id="driver" required aria-required="true" suggestions={suggestions} suggestionsLabel="Known drivers" onPick={vi.fn()} /></>);
    const input = screen.getByRole("combobox", { name: "Driver" });
    expect(input.getAttribute("aria-required")).toBe("true");
    fireEvent.focus(input);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    const options = screen.getAllByRole("option");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0].id);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(options[1].id);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.getAttribute("aria-activedescendant")).toBeNull();
  });

  it("keeps active-descendant options out of the tab order without nested buttons", () => {
    const onPick = vi.fn();
    render(<><label htmlFor="driver-safe">Driver</label><GateMemoryInput id="driver-safe" suggestions={suggestions} suggestionsLabel="Known drivers" onPick={onPick} /></>);
    const input = screen.getByRole("combobox", { name: "Driver" });
    fireEvent.focus(input);
    const option = screen.getAllByRole("option")[0];
    expect(option.querySelector("button, a, [tabindex]" )).toBeNull();
    fireEvent.mouseDown(option);
    fireEvent.click(option);
    expect(onPick).toHaveBeenCalledWith(suggestions[0]);
  });
});
