import { describe, expect, it, vi } from "vitest";
import {
  isFleetMigrationMain,
  runFleetMobileWorkflowsMigration,
} from "../../scripts/migrate-fleet-mobile-workflows";

describe("Fleet mobile migration entry point", () => {
  it("runs the main function for a POSIX script path", () => {
    expect(isFleetMigrationMain(
      "file:///home/vndrly/app/artifacts/api-server/scripts/migrate-fleet-mobile-workflows.ts",
      "/home/vndrly/app/artifacts/api-server/scripts/migrate-fleet-mobile-workflows.ts",
      "linux",
    )).toBe(true);
  });
  it("does not run main when the module is imported", () => {
    expect(isFleetMigrationMain(
      "file:///home/vndrly/app/artifacts/api-server/scripts/migrate-fleet-mobile-workflows.ts",
      "/home/vndrly/app/artifacts/api-server/src/services/test.ts",
      "linux",
    )).toBe(false);
  });

  it("restarts the entire transaction on a PostgreSQL deadlock", async () => {
    const deadlock = Object.assign(new Error("deadlock detected"), { code: "40P01" });
    const first = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce(deadlock)
        .mockResolvedValueOnce({ rows: [] }),
      release: vi.fn(),
    };
    const second = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
    const connect = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);

    await expect(runFleetMobileWorkflowsMigration({ connect } as never, async () => undefined)).resolves.toBeUndefined();

    expect(connect).toHaveBeenCalledTimes(2);
    expect(first.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(first.release).toHaveBeenCalledOnce();
    expect(second.query).toHaveBeenLastCalledWith("COMMIT");
    expect(second.release).toHaveBeenCalledOnce();
  });
});
