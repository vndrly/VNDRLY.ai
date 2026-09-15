import { describe, expect, it, vi } from "vitest";
import { recordSupervisorException } from "./supervisor-exceptions";

function harness() {
  const claimed = new Set<string>();
  const deps = {
    claim: vi.fn(async (key: string) => {
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    }),
    writeAudit: vi.fn(async () => undefined),
    resolveRecipients: vi.fn(async () => [21, 22]),
    notify: vi.fn(async () => 2),
  };
  return deps;
}

describe("recordSupervisorException", () => {
  it.each([
    ["field_mode_exception", "end_work_unanswered"],
    ["field_mode_exception", "extended_stop_unanswered"],
    ["gate_exception", "unresolved_gate_observation"],
  ] as const)("delivers one scoped supervisor exception for %s %s", async (kind, reason) => {
    const deps = harness();
    const input = {
      actorUserId: 7,
      owner: { type: "vendor" as const, id: 9 },
      eventId: "shift-44:timeout",
      kind,
      reason,
    };
    expect(await recordSupervisorException(input, deps)).toMatchObject({ created: true, notified: 2 });
    expect(await recordSupervisorException(input, deps)).toMatchObject({ created: false, notified: 0 });
    expect(deps.writeAudit).toHaveBeenCalledTimes(1);
    expect(deps.notify).toHaveBeenCalledTimes(1);
  });

  it("does not accept routine user-input recovery as an operations exception", async () => {
    const deps = harness();
    await expect(
      recordSupervisorException(
        {
          actorUserId: 7,
          owner: { type: "vendor", id: 9 },
          eventId: "draft-1",
          kind: "input_error" as never,
          reason: "short_plate" as never,
        },
        deps,
      ),
    ).rejects.toMatchObject({ code: "operations_health.invalid_event" });
    expect(deps.notify).not.toHaveBeenCalled();
  });
});
