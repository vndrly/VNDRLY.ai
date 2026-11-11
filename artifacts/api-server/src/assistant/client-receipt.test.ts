import { describe, expect, it } from "vitest";
import { attachClientReceipts, clientReceiptsSchema, clientReceiptDisplayContent } from "./client-receipt";
describe("authenticated display receipts", () => {
  const call = { name: "open_screen", organizationKey: "vendor:2", output: '{"execution":"client","intent":{"name":"open_screen"}}' };
  it("reopens a failed navigation with the observed display result rather than a success claim", () => {
    const calls = attachClientReceipts([call], [{ ok: false, message: "Gate Map did not render" }], "vendor:2");
    expect(clientReceiptDisplayContent("Opened Gate Map", calls)).toBe("Gate Map did not render");
    expect(clientReceiptDisplayContent("Saved task", [{ output: "untrusted" }])).toBe("Saved task");
  });
  it("attaches only a matching display outcome, retaining the original server result", () => {
    expect(attachClientReceipts([call], [{ ok: false, message: "Page did not render" }], "vendor:2")?.[0]).toMatchObject({ ...call, clientReceipt: { ok: false, authority: "display_only" } });
  });
  it("rejects cross-company, excess and mutation-only receipts", () => {
    expect(attachClientReceipts([call], [{ ok: true, message: "opened" }], "vendor:3")).toBeNull();
    expect(attachClientReceipts([{ ...call, output: '{"ok":true}' }], [{ ok: true, message: "saved" }], "vendor:2")).toBeNull();
    expect(clientReceiptsSchema.safeParse({ receipts: [{ ok: true, message: "opened", confirmed: true }] }).success).toBe(false);
  });
});
