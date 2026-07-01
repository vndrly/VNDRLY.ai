import { describe, expect, it } from "vitest";

import { markdownToSpeechText } from "./openai-whisper";

describe("markdownToSpeechText", () => {
  it("flattens markdown links and emphasis", () => {
    expect(
      markdownToSpeechText("Open [Ticket #12](/tickets/12) **now**."),
    ).toBe("Open Ticket 12 now.");
  });
});
