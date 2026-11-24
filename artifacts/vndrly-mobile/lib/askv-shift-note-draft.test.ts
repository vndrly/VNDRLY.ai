import { describe, expect, it } from "vitest";
import { preparedShiftNoteMatchesDraft, reviseShiftNote, shiftNoteDecision, shiftNoteFromCommand } from "./askv-shift-note-draft";

describe("AskV spoken shift note draft", () => {
  it("extracts the dictated text from close variants", () => {
    expect(shiftNoteFromCommand("Add shift note: Barrier damaged at 5:15"))
      .toBe("Barrier damaged at 5:15");
    expect(shiftNoteFromCommand("Hey V, write a handoff note that Bob arrived late"))
      .toBe("Bob arrived late");
    expect(shiftNoteFromCommand("Agrega una nota de turno: barrera dañada"))
      .toBe("barrera dañada");
    expect(shiftNoteFromCommand("Who is on shift? ")).toBeNull();
  });

  it("accepts corrections without approving the draft", () => {
    expect(reviseShiftNote("Bob arrived at 5:15", "Change 5:15 to 5:50"))
      .toBe("Bob arrived at 5:50");
    expect(reviseShiftNote("Bob arrived at 5:15", "Actually, Bob left at 5:15"))
      .toBe("Bob left at 5:15");
    expect(reviseShiftNote("Bob arrived at 5:15", "Who is on shift?"))
      .toBeNull();
    expect(reviseShiftNote("Bob arrived at 5:15", "Change John to Jim"))
      .toBeNull();
  });

  it("recognizes direct approval and cancellation, not questions or quoted words", () => {
    expect(shiftNoteDecision("yes")) .toBe("approve");
    expect(shiftNoteDecision("go ahead")) .toBe("approve");
    expect(shiftNoteDecision("cancel")) .toBe("cancel");
    expect(shiftNoteDecision("Did he say confirm?")) .toBeNull();
  });

  it("offers approval only for the server's exact prepared note text", () => {
    expect(preparedShiftNoteMatchesDraft({ action: "add_shift_note", text: "Barrier damaged at 5:15" }, "Barrier damaged at 5:15")).toBe(true);
    expect(preparedShiftNoteMatchesDraft({ action: "add_shift_note", text: "Barrier damaged at 5:50" }, "Barrier damaged at 5:15")).toBe(false);
    expect(preparedShiftNoteMatchesDraft({ action: "open_item", text: "Barrier damaged at 5:15" }, "Barrier damaged at 5:15")).toBe(false);
  });
});
