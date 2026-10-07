import { expect, it, vi } from "vitest";
import { instrumentPoolConnect } from "./instrument-pool-connect";

it("forwards callback acquisition and release without entering a transaction barrier", () => {
  const client = { query: vi.fn() }, release = vi.fn(), callback = vi.fn();
  const connect = vi.fn((cb: unknown) => { (cb as Function)(null, client, release); return undefined; });
  const instrument = vi.fn();
  expect(instrumentPoolConnect(connect, instrument)(callback)).toBeUndefined();
  expect(callback).toHaveBeenCalledWith(null, client, release);
  expect(instrument).not.toHaveBeenCalled();
});

it("instruments promise acquisition while preserving query configuration and callbacks", async () => {
  const query = vi.fn(), client = { query }, wrapped = { query: (...args: unknown[]) => client.query(...args) };
  const connect = vi.fn(async () => client), instrument = vi.fn(() => wrapped);
  expect(await instrumentPoolConnect(connect, instrument)()).toBe(wrapped);
  const config = { text: "SELECT id FROM users FOR UPDATE", rowMode: "array", values: [7] }, callback = vi.fn();
  wrapped.query(config, callback);
  expect(query).toHaveBeenCalledWith(config, callback);
  expect(instrument).toHaveBeenCalledWith(client);
});
