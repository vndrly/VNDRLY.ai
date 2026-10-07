import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ pool: {} }));
import { withPlanExecutionRecords } from "./plan-execution-store";

function fixture(value: unknown = []) {
  const query = vi.fn(async (sql: string) => sql.startsWith("SELECT")
    ? { rows: [{ assistant_plan_executions: value }] }
    : { rows: [] });
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  return { query, release, connect, pool: { connect } };
}

describe("private plan execution persistence", () => {
  it("locks one owner and saves only the successful operation", async () => {
    const f = fixture();
    const result = await withPlanExecutionRecords(1073, async records => {
      records.push({ id: "test-run", state: "pending" });
      return "saved";
    }, f.pool as never);
    expect(result).toBe("saved");
    expect(f.query).toHaveBeenCalledWith(
      "SELECT assistant_plan_executions FROM users WHERE id = $1 FOR UPDATE", [1073],
    );
    expect(f.query).toHaveBeenCalledWith(
      "UPDATE users SET assistant_plan_executions = $2::jsonb WHERE id = $1",
      [1073, JSON.stringify([{ id: "test-run", state: "pending" }])],
    );
    expect(f.query).toHaveBeenCalledWith("COMMIT");
    expect(f.release).toHaveBeenCalledOnce();
  });

  it("rolls back a failed operation without persisting its partial mutation", async () => {
    const f = fixture();
    await expect(withPlanExecutionRecords(1073, async records => {
      records.push({ state: "completed" });
      throw new Error("authority revoked");
    }, f.pool as never)).rejects.toThrow("authority revoked");
    expect(f.query.mock.calls.some(([sql]) => sql.startsWith("UPDATE"))).toBe(false);
    expect(f.query).toHaveBeenCalledWith("ROLLBACK");
    expect(f.release).toHaveBeenCalledOnce();
  });

  it("refuses corrupt private storage without replacing it", async () => {
    const f = fixture({ unexpected: true });
    const operation = vi.fn();
    await expect(withPlanExecutionRecords(1073, operation, f.pool as never))
      .rejects.toThrow("Invalid private execution storage");
    expect(operation).not.toHaveBeenCalled();
    expect(f.query.mock.calls.some(([sql]) => sql.startsWith("UPDATE"))).toBe(false);
    expect(f.release).toHaveBeenCalledOnce();
  });

  it("rejects an invalid owner before acquiring a database connection", async () => {
    const f = fixture();
    await expect(withPlanExecutionRecords(0, vi.fn(), f.pool as never))
      .rejects.toThrow("Invalid execution owner");
    expect(f.connect).not.toHaveBeenCalled();
  });
});
