import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ foreground: "white", primary: "gold" }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import GateGpsEvidence from "./GateGpsEvidence";
afterEach(cleanup);
it("distinguishes GPS mismatch and unavailable evidence with the recorded gate", () => {
  render(<GateGpsEvidence row={{ checkInGpsEvidence: { status: "mismatch", gateName: "Movable post", distanceMeters: 730 }, checkOutGpsEvidence: { status: "unavailable" } }} />);
  expect(screen.getByTestId("gps-checkInGpsEvidence").textContent).toContain("gatekeeper.gpsEvidence.mismatch · Movable post · 730 m");
  expect(screen.getByTestId("gps-checkOutGpsEvidence").textContent).toContain("gatekeeper.gpsEvidence.unavailable");
});
it("does not label older records without evidence as verified", () => {
  render(<GateGpsEvidence row={{}} />);
  expect(screen.queryByTestId("gps-checkInGpsEvidence")).toBeNull();
});
