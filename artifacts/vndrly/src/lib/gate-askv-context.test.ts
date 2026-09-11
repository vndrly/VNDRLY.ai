import { describe, expect, it } from "vitest";

import {
  applyGateAskVTurn,
  evaluateGateAskVTurn,
  type GateAskVDraftContext,
} from "./gate-askv-context";

const context = (overrides: Partial<GateAskVDraftContext> = {}): GateAskVDraftContext => ({
  selectedSite: { name: "Rock Island", address: "Grady County, Oklahoma" },
  draft: {
    firstName: "John",
    lastName: "Mark",
    company: "Peak Energy",
    vehiclePlate: "ABC123",
    plateState: "TX",
    purpose: "Delivery",
    notes: "",
    expectedDurationMinutes: 120,
  },
  selectedHost: null,
  authorizedHosts: [
    { label: "Flywheel Energy", type: "partner" },
    { label: "Peak Services", type: "vendor" },
  ],
  ...overrides,
});

describe("Gate Ask V draft context", () => {
  it("answers an expected-duration question from the current visible draft", () => {
    expect(
      evaluateGateAskVTurn(
        "did you capture how long he is supposed to be on site?",
        context(),
        4,
      ),
    ).toEqual({
      kind: "answer",
      topic: "duration",
      messageKey: "gatekeeper.askvDurationCaptured",
      params: { duration: "2 hours" },
      contextEpoch: 4,
    });
  });

  it("asks for the duration when the visible draft has none", () => {
    expect(
      evaluateGateAskVTurn(
        "how long is he supposed to be here?",
        context({ draft: { ...context().draft, expectedDurationMinutes: null } }),
        1,
      ),
    ).toMatchObject({
      kind: "clarification",
      reason: "missing-duration",
      messageKey: "gatekeeper.askvDurationMissing",
    });
  });

  it("resolves an explicitly spoken host only from one authorized visible option", () => {
    expect(evaluateGateAskVTurn("host Flywheel Energy", context(), 2)).toEqual({
      kind: "host-selection",
      host: { label: "Flywheel Energy", type: "partner" },
      messageKey: "gatekeeper.askvHostSelected",
      params: { host: "Flywheel Energy" },
      contextEpoch: 2,
    });
  });

  it("asks for clarification when an authorized host name is ambiguous", () => {
    const result = evaluateGateAskVTurn(
      "host Peak",
      context({
        authorizedHosts: [
          { label: "Peak Energy", type: "partner" },
          { label: "Peak Services", type: "vendor" },
        ],
      }),
      3,
    );
    expect(result).toMatchObject({
      kind: "clarification",
      reason: "ambiguous-host",
      messageKey: "gatekeeper.askvHostAmbiguous",
      params: { options: "Peak Energy or Peak Services" },
    });
  });

  it("does not answer or fill without a currently authorized selected site", () => {
    expect(
      evaluateGateAskVTurn(
        "did you capture how long he is supposed to be on site?",
        context({ selectedSite: null, authorizedHosts: [] }),
        6,
      ),
    ).toMatchObject({
      kind: "clarification",
      reason: "no-site",
      messageKey: "gatekeeper.askvSelectSite",
    });
  });

  it("discards a result after the authorization or selected-site context changes", () => {
    const result = evaluateGateAskVTurn("host Flywheel Energy", context(), 7);
    expect(applyGateAskVTurn(result, 8)).toEqual({ kind: "stale" });
  });

  it("returns an answer without mutating the current draft", () => {
    const original = context();
    const before = structuredClone(original);
    const result = evaluateGateAskVTurn(
      "did you capture how long he is supposed to be on site?",
      original,
      5,
    );
    expect(result.kind).toBe("answer");
    expect(original).toEqual(before);
  });
});
