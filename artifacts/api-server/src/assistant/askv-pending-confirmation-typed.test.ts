import { describe, expect, it, vi } from "vitest";
import {
  runBoundTypedAskVTool,
  synchronizeTypedAskVContext,
} from "./askv-pending-confirmation";
const mock = vi.hoisted(() => ({
  execute: vi.fn(async (input: unknown) => JSON.stringify({ ok: true, input })),
}));
vi.mock("./askv-idempotency", async () => ({
  ...(await vi.importActual("./askv-idempotency")),
  runPersistentAskVMutation: async (
    _scope: unknown,
    execute: () => Promise<string>,
  ) => ({ hit: false, value: await execute() }),
}));
const base = {
  name: "confirm_visitor_check_out",
  input: { visitId: 44, confirmed: true },
  session: { userId: 10, role: "vendor", vendorId: 22 },
  turnId: 1,
  contextKey: "/gate:9",
  phrase: "Check out Bob",
  execute: mock.execute,
};
describe("AskV typed mutation confirmation", () => {
  it("ignores model confirmed:true and binds the later user confirmation to exact arguments", async () => {
    mock.execute.mockClear();
    const first = { ...base, conversationId: 1101 };
    expect(
      JSON.parse(await runBoundTypedAskVTool(first)).requiresConfirmation,
    ).toBe(true);
    expect(mock.execute).not.toHaveBeenCalled();
    expect(
      JSON.parse(
        await runBoundTypedAskVTool({
          ...first,
          turnId: 2,
          phrase: "yes",
          input: { visitId: 99, confirmed: true },
        }),
      ).requiresConfirmation,
    ).toBe(true);
    expect(mock.execute).not.toHaveBeenCalled();
    const confirmed = JSON.parse(
      await runBoundTypedAskVTool({
        ...first,
        turnId: 3,
        phrase: "yes",
        input: { visitId: 99 },
      }),
    );
    expect(confirmed).toMatchObject({
      ok: true,
      input: {
        visitId: 99,
        confirmed: true,
        idempotencyKey: expect.any(String),
      },
    });
  });
  it("clears pending approval on cancellation even when the model calls no tool that turn", async () => {
    const first = { ...base, conversationId: 1102 };
    await runBoundTypedAskVTool(first);
    synchronizeTypedAskVContext(base.session, 1102, base.contextKey, "cancel");
    expect(
      JSON.parse(
        await runBoundTypedAskVTool({ ...first, turnId: 3, phrase: "yes" }),
      ).requiresConfirmation,
    ).toBe(true);
  });
  it("does not carry a confirmation across organization or screen changes", async () => {
    const first = { ...base, conversationId: 1103 };
    await runBoundTypedAskVTool(first);
    expect(
      JSON.parse(
        await runBoundTypedAskVTool({
          ...first,
          turnId: 2,
          phrase: "yes",
          contextKey: "/tickets:44",
        }),
      ).requiresConfirmation,
    ).toBe(true);
    expect(
      JSON.parse(
        await runBoundTypedAskVTool({
          ...first,
          turnId: 3,
          phrase: "yes",
          session: { ...base.session, vendorId: 23 },
        }),
      ).requiresConfirmation,
    ).toBe(true);
  });
});
