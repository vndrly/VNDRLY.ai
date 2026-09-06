import { describe, expect, it } from "vitest";
import { isClientTool, runClientTool } from "./client-tools";
const field = { userId: 10, role: "field_employee" };
describe("AskV client tools", () => {
  it("returns an intent only after validating navigation role and required record", () => {
    expect(
      JSON.parse(runClientTool("open_screen", { screen: "invoices" }, field))
        .ok,
    ).toBe(false);
    expect(
      JSON.parse(
        runClientTool("open_screen", { screen: "ticket-detail" }, field),
      ).ok,
    ).toBe(false);
    expect(
      JSON.parse(
        runClientTool(
          "open_screen",
          { screen: "ticket-detail", id: 42 },
          field,
        ),
      ),
    ).toMatchObject({
      ok: true,
      execution: "client",
      intent: {
        name: "open_screen",
        arguments: { screen: "ticket-detail", id: 42 },
      },
    });
  });
  it("rejects unknown clients, capabilities and malformed entry inputs", () => {
    expect(JSON.parse(runClientTool("launch_camera", {})).ok).toBe(false);
    expect(JSON.parse(runClientTool("invented", {}, field)).ok).toBe(false);
    expect(
      JSON.parse(
        runClientTool(
          "start_ticket_entry",
          { ticketId: 42, kind: "approve" },
          field,
        ),
      ).ok,
    ).toBe(false);
    expect(
      JSON.parse(
        runClientTool(
          "start_ticket_entry",
          { ticketId: -1, kind: "photo" },
          field,
        ),
      ).ok,
    ).toBe(false);
  });
  it("does not claim a client capability already completed", () => {
    expect(isClientTool("launch_camera")).toBe(true);
    expect(JSON.parse(runClientTool("launch_camera", {}, field))).toMatchObject(
      { ok: true, execution: "client", intent: { name: "launch_camera" } },
    );
  });
});
