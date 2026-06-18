import { describe, expect, it } from "vitest";
import {
  recipientDetail,
  recipientHeadline,
  selectedRecipientUserIds,
  sendToRowKey,
} from "@/lib/send-to-display";
import type { SendToRecipient } from "@/lib/ticket-send-to-api";

describe("send-to-display (web)", () => {
  it("keeps row selection independent per group", () => {
    const rows = [
      sendToRowKey("on_ticket", 750),
      sendToRowKey("vendor_poc_field", 750),
      sendToRowKey("vendor_poc_office", 750),
    ];
    const selected = new Set([rows[0], rows[2]]);
    expect(selectedRecipientUserIds(selected)).toEqual([750]);
    expect(selected.size).toBe(2);
  });

  it("prefers headline and detail from API payload", () => {
    const recipient: SendToRecipient = {
      userId: 1,
      displayName: "void-audit-123-abc-Vendor Admin",
      email: null,
      group: "vendor_poc_office",
      roleLabel: "legacy",
      headline: "Vendor admin",
      detail: "Baker Hughes · vendor office / billing POC",
    };
    expect(recipientHeadline(recipient)).toBe("Vendor admin");
    expect(recipientDetail(recipient)).toBe("Baker Hughes · vendor office / billing POC");
  });
});
