import { describe, expect, it } from "vitest";
import {
  matchGateCheckoutVisits,
  parseGateVoiceCommand,
  parseGateVoiceEntry,
  recoverGateVoiceCommand,
} from "./gate-voice-entry";

describe("parseGateVoiceEntry", () => {
  it("extracts plate and driver from the minimum spoken command", () => {
    expect(parseGateVoiceEntry("license plate ok 4412 driver Bob Villa")).toEqual({
      vehiclePlate: "OK4412",
      firstName: "Bob",
      lastName: "Villa",
    });
  });

  it("extracts optional spoken notes after purpose", () => {
    expect(
      parseGateVoiceEntry(
        "plate ABC123 driver Bob Villa purpose delivery notes muddy specialty tag no state",
      ),
    ).toMatchObject({
      vehiclePlate: "ABC123",
      firstName: "Bob",
      lastName: "Villa",
      purpose: "delivery",
      notes: "muddy specialty tag no state",
    });
  });

  it.each([
    ["TX plate ABC 123 driver Bob Villa", "TX"],
    ["Texas, plate ABC 123 driver Bob Villa", "TX"],
    ["state IN plate ABC 123 driver Bob Villa", "IN"],
    ["state OR tag ABC 123 driver Bob Villa", "OR"],
    ["state ME license plate ABC 123 driver Bob Villa", "ME"],
    ["state OK plate ABC 123 driver Bob Villa", "OK"],
    ["state HI tag ABC 123 driver Bob Villa", "HI"],
    ["state ID license plate ABC 123 driver Bob Villa", "ID"],
    ["state OH plate ABC 123 driver Bob Villa", "OH"],
    ["Ohio, plate ABC 123 driver Bob Villa", "OH"],
  ])("extracts a precisely cued state without contaminating the plate from %s", (transcript, code) => {
    expect(parseGateVoiceEntry(transcript)).toMatchObject({
      plateState: code,
      vehiclePlate: "ABC123",
    });
  });

  it.each([
    "IN plate ABC 123 driver Bob Villa",
    "OR plate ABC 123 driver Bob Villa",
    "ME plate ABC 123 driver Bob Villa",
    "OK plate ABC 123 driver Bob Villa",
    "HI plate ABC 123 driver Bob Villa",
    "ID plate ABC 123 driver Bob Villa",
    "OH plate ABC 123 driver Bob Villa",
    "Oh, plate ABC 123 driver Bob Villa",
    "check in plate ABC 123 driver Bob Villa",
    "ZZ plate ABC 123 driver Bob Villa",
  ])(
    "does not infer an uncued or invalid state from %s",
    (transcript) => {
      const parsed = parseGateVoiceEntry(transcript);
      expect(parsed).not.toHaveProperty("plateState");
      expect(parsed.vehiclePlate).toBe("ABC123");
    },
  );

  it("does not treat a plate prefix or driver name as state input", () => {
    expect(parseGateVoiceEntry("plate TXABC123 driver Texas Bob")).toEqual({
      vehiclePlate: "TXABC123",
      firstName: "Texas",
      lastName: "Bob",
    });
  });
});

describe("parseGateVoiceCommand", () => {
  it("understands driver and plate checkout phrases", () => {
    expect(parseGateVoiceCommand("Bob Villa checking out")).toEqual({
      intent: "check-out",
      fill: { firstName: "Bob", lastName: "Villa" },
    });
    expect(parseGateVoiceCommand("plate 51D-4A1 checking out")).toEqual({
      intent: "check-out",
      fill: { vehiclePlate: "51D-4A1" },
    });
  });

  it("understands a natural check-in command", () => {
    expect(parseGateVoiceCommand("check in Bob Villa from Peak Energy plate ABC123 purpose delivery duration 45 minutes")).toEqual({
      intent: "check-in",
      fill: {
        firstName: "Bob",
        lastName: "Villa",
        company: "Peak Energy",
        vehiclePlate: "ABC123",
        purpose: "delivery",
        duration: "45",
      },
    });
  });

  it("captures the purpose for a first-time company in natural speech", () => {
    expect(parseGateVoiceCommand("check in Bob Villa from NewCo plate ABC123 for equipment delivery")).toEqual({
      intent: "check-in",
      fill: {
        firstName: "Bob",
        lastName: "Villa",
        company: "NewCo",
        vehiclePlate: "ABC123",
        purpose: "equipment delivery",
      },
    });
  });

  it("understands with-company and here-for phrasing", () => {
    expect(parseGateVoiceCommand("Bob Villa with NewCo plate ABC123 checking in here for inspection")).toEqual({
      intent: "check-in",
      fill: {
        firstName: "Bob",
        lastName: "Villa",
        company: "NewCo",
        vehiclePlate: "ABC123",
        purpose: "inspection",
      },
    });
  });
});

describe("matchGateCheckoutVisits", () => {
  const visits = [
    { id: 1, firstName: "Bob", lastName: "Villa", company: "Peak Energy", vehiclePlate: "51D-4A1", checkInTime: "2026-08-25T16:00:00Z" },
    { id: 2, firstName: "Alice", lastName: "Jones", company: "Peak Energy", vehiclePlate: "ABC123", checkInTime: "2026-08-25T17:00:00Z" },
  ];

  it("finds an active visit by full name or normalized plate", () => {
    expect(matchGateCheckoutVisits(visits, { firstName: "Bob", lastName: "Villa" }).map((visit) => visit.id)).toEqual([1]);
    expect(matchGateCheckoutVisits(visits, { vehiclePlate: "51d4a1" }).map((visit) => visit.id)).toEqual([1]);
  });
});

describe("recoverGateVoiceCommand", () => {
  const history = [
    {
      id: 9,
      firstName: "Bob",
      lastName: "Villa",
      company: "Grady Farms",
      vehiclePlate: "8TRK22",
      plateState: "TX",
      checkInTime: "2026-09-14T12:00:00Z",
    },
  ];

  it("asks only for a missing full name", () => {
    expect(
      recoverGateVoiceCommand(
        parseGateVoiceCommand("check in Texas, plate 8TRK22"),
        history,
      ),
    ).toMatchObject({ ready: false, missing: ["name"], offerCamera: false });
  });

  it("offers the camera when a spoken plate is too short", () => {
    expect(
      recoverGateVoiceCommand(
        parseGateVoiceCommand("check in Bob Villa plate 12 state Texas"),
        history,
      ),
    ).toMatchObject({ ready: false, missing: ["plate"], offerCamera: true });
  });

  it("asks for jurisdiction when the plate has no state", () => {
    expect(
      recoverGateVoiceCommand(
        parseGateVoiceCommand("check in Bob Villa plate 8TRK22"),
        history,
      ),
    ).toMatchObject({
      ready: false,
      missing: ["plateState"],
      offerCamera: true,
    });
  });

  it("uses matching history to offer recent fleet plates without binding a driver to one truck", () => {
    expect(
      recoverGateVoiceCommand(
        parseGateVoiceCommand("check in Bob Villa from Grady Farms"),
        history,
      ),
    ).toMatchObject({
      ready: false,
      missing: ["plate"],
      suggestedPlates: [{ vehiclePlate: "8TRK22", plateState: "TX" }],
    });
  });
});
