import { describe, expect, it } from "vitest";
import {
  MICROSOFT_IMPORT_CATEGORIES,
  microsoftImportStatus,
  validateImportSelection,
} from "./microsoft-import";

describe("Microsoft one-way import contract", () => {
  it("exposes only categories that can be copied into VNDRLY", () => {
    expect(MICROSOFT_IMPORT_CATEGORIES).toEqual([
      "calendar",
      "files_notes",
      "conversations",
      "tasks_forms",
      "meetings",
    ]);
  });

  it("never advertises a VNDRLY-to-Microsoft write capability", () => {
    expect(microsoftImportStatus(true)).toMatchObject({
      direction: "microsoft_to_vndrly",
      writeBack: false,
      activationRequiresReview: true,
    });
  });

  it("deduplicates selected external identifiers and rejects unsupported categories", () => {
    expect(
      validateImportSelection([
        { category: "calendar", externalId: "event-1" },
        { category: "calendar", externalId: "event-1" },
      ]),
    ).toEqual([{ category: "calendar", externalId: "event-1" }]);
    expect(() =>
      validateImportSelection([
        { category: "contacts", externalId: "person-1" },
      ]),
    ).toThrow("Unsupported Microsoft import category");
  });
});
