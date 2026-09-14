import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import OperationsDisplayPage from "./operations-display";

describe("OperationsDisplayPage", () => {
  it("renders an approved view as a read-only full-screen operations surface", () => {
    render(<OperationsDisplayPage displayName="Dispatch wall" monitorName="Monitor A" view="crew_map" privacyMode />);
    expect(screen.getByRole("heading", { name: "Crew map" })).toBeTruthy();
    expect(screen.getByText("Dispatch wall · Monitor A")).toBeTruthy();
    expect(screen.getByText("Read-only display")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("keeps room media off until an authorized room controller enables it", () => {
    render(<OperationsDisplayPage displayName="Conference room" monitorName="Room" view="meeting_room" privacyMode={false} />);
    expect(screen.getByText("Camera off · Microphone off")).toBeTruthy();
  });
});
