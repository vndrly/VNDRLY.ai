import { beforeEach, expect, it, vi } from "vitest";
import { conversationalConfirmation } from "./conversational-confirmation";
const request = vi.hoisted(() => vi.fn());
vi.mock("./openai-text", () => ({ requestOpenAIText: request }));
beforeEach(() => request.mockReset());
it("keeps explicit approvals fast", async () => {
  expect(await conversationalConfirmation("I confirm", "confirm_visitor_check_in")).toBe("confirm");
  expect(request).not.toHaveBeenCalled();
});
it.each(["confirm", "cancel", "none"] as const)("uses semantic decision %s for conversational replies", async decision => {
  request.mockResolvedValue({ content: [{ type: "text", text: decision }] });
  expect(await conversationalConfirmation("Go ahead and confirmed it.", "confirm_visitor_check_in")).toBe(decision);
  expect(request.mock.calls[0][0].messages[0].content).toContain("Go ahead and confirmed it.");
});
it("cannot approve on classifier failure or invalid output", async () => {
  request.mockRejectedValueOnce(new Error("timeout"));
  expect(await conversationalConfirmation("Go ahead and confirmed it.", "confirm_visitor_check_in")).toBe("none");
  request.mockResolvedValueOnce({ content: [{ type: "text", text: "probably confirm" }] });
  expect(await conversationalConfirmation("Go ahead and confirmed it.", "confirm_visitor_check_in")).toBe("none");
});
