import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import GateHistoryRecordDetails, { type GateHistoryRecord } from "./gate-history-record-details";

const locale = vi.hoisted(() => ({ language: "en" }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: locale }) }));
afterEach(() => { cleanup(); locale.language = "en"; });
const show = (record: GateHistoryRecord) => render(<GateHistoryRecordDetails open record={record} loading={false} failed={false} onClose={() => {}} />);

describe("Gate record association", () => {
  it("identifies a historical correction without inventing GPS assurance and preserves recorded details", () => {
    show({ id: "visit:88", name: "Driver", gateStationId: "station-399", gateName: "Main Gate", gateAssociationSource: "user_supplied_historical_correction", gateAssociationProvenance: { source: "user_supplied_historical_correction", correctionId: "correction-1", correctedAt: "2026-10-28T12:00:00Z", instruction: "Associate historical records with their site's Main Gate" }, notes: "Original crossing note" });
    expect(screen.getByText("Main Gate")).toBeTruthy();
    expect(screen.getByText("User-supplied historical correction")).toBeTruthy();
    expect(screen.getByText("Original crossing note")).toBeTruthy();
    expect(screen.getByRole("dialog").textContent).not.toMatch(/GPS|verified|Recorded gate selection/i);
  });

  it("distinguishes an original recorded gate selection", () => {
    show({ id: "visit:89", gateName: "East Gate", gateAssociationSource: "check_in_gps_evidence" });
    expect(screen.getByText("East Gate")).toBeTruthy();
    expect(screen.getByText("Recorded gate selection")).toBeTruthy();
    expect(screen.queryByText("User-supplied historical correction")).toBeNull();
  });

  it("keeps a record with no gate unknown instead of using GPS evidence as an association", () => {
    show({ id: "visit:90", checkInGpsEvidence: { status: "verified", gateName: "Nearby Main Gate" } });
    expect(screen.getByText("Unknown")).toBeTruthy();
    expect(screen.queryByText("Nearby Main Gate")).toBeNull();
    expect(screen.queryByText("Recorded gate selection")).toBeNull();
  });

  it("labels the correction in Spanish", () => {
    locale.language = "es";
    show({ id: "visit:91", gateName: "Main Gate", gateAssociationSource: "user_supplied_historical_correction" });
    expect(screen.getByText("Corrección histórica proporcionada por el usuario")).toBeTruthy();
  });
});
