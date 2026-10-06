import { beforeEach, describe, expect, it, vi } from "vitest";

const { connect } = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("@workspace/db", () => ({ pool: { connect } }));
vi.mock("./gate-notification-events", () => ({ notifyGateSiteEvent: vi.fn() }));

import { changeOverTransaction } from "./gate-change-over";

describe("Gate handoff transaction recovery", () => {
  beforeEach(() => connect.mockReset());

  function client() {
    const result = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
    connect.mockResolvedValue(result);
    return result;
  }

  it("rolls back and releases a deadlock victim before rechecking the whole operation", async () => {
    const first = client();
    const second = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
    connect.mockResolvedValueOnce(first).mockImplementationOnce(() => {
      expect(first.query).toHaveBeenLastCalledWith("ROLLBACK");
      expect(first.release).toHaveBeenCalledOnce();
      return Promise.resolve(second);
    });
    const work = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("deadlock"), { code: "40P01" }))
      .mockResolvedValueOnce({ applied: true });
    await expect(changeOverTransaction(work)).resolves.toEqual({ applied: true });
    expect(work.mock.calls.map(([connection]) => connection)).toEqual([first, second]);
    expect(first.query.mock.calls.some(([sql]) => sql === "COMMIT")).toBe(false);
    expect(second.query).toHaveBeenLastCalledWith("COMMIT");
    expect(second.release).toHaveBeenCalledOnce();
  });

  it("bounds repeated deadlocks to three attempts", async () => {
    const connection = client();
    const error = Object.assign(new Error("deadlock"), { code: "40P01" });
    const work = vi.fn().mockRejectedValue(error);
    await expect(changeOverTransaction(work)).rejects.toBe(error);
    expect(connect).toHaveBeenCalledTimes(3);
    expect(work).toHaveBeenCalledTimes(3);
    expect(connection.release).toHaveBeenCalledTimes(3);
  });

  it("does not retry an authorization or revision failure", async () => {
    const connection = client();
    const error = Object.assign(new Error("revision changed"), { code: "change_over.stale" });
    const work = vi.fn().mockRejectedValue(error);
    await expect(changeOverTransaction(work)).rejects.toBe(error);
    expect(connect).toHaveBeenCalledOnce();
    expect(connection.query).toHaveBeenLastCalledWith("ROLLBACK");
  });

  it("does not replay an uncertain commit", async () => {
    const connection = client();
    const error = Object.assign(new Error("connection lost"), { code: "ECONNRESET" });
    connection.query.mockImplementation(async (sql) => {
      if (sql === "COMMIT") throw error;
      return { rows: [] };
    });
    const work = vi.fn().mockResolvedValue({ applied: true });
    await expect(changeOverTransaction(work)).rejects.toBe(error);
    expect(work).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledOnce();
  });

  it("does not retry when rollback itself fails", async () => {
    const connection = client();
    const rollbackError = new Error("rollback connection lost");
    connection.query.mockImplementation(async (sql) => {
      if (sql === "ROLLBACK") throw rollbackError;
      return { rows: [] };
    });
    const work = vi.fn().mockRejectedValue(Object.assign(new Error("deadlock"), { code: "40P01" }));
    await expect(changeOverTransaction(work)).rejects.toBe(rollbackError);
    expect(connect).toHaveBeenCalledOnce();
    expect(connection.release).toHaveBeenCalledOnce();
  });
});
