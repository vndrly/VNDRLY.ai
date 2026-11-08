import { test } from "node:test";
import assert from "node:assert/strict";
import { createRealmDispatcher, runInDatabaseRealm } from "./database-realm";
import {
  createTrainingWorkerDispatcher,
  runWithTrainingWorkerDatabase,
  trainingWorkerPoolConfig,
} from "./training-worker-database";

function fakeDatabase(name: string) {
  return { name, query() { return this.name; }, connect() { return { name: this.name }; } };
}

test("parallel request and worker chains retain separate pools and exact realms", async () => {
  const requests = createRealmDispatcher(fakeDatabase("request-production"), () => fakeDatabase("request-demo"));
  const workers = createRealmDispatcher(fakeDatabase("worker-production"), () => fakeDatabase("worker-demo"));
  const target = createTrainingWorkerDispatcher(requests, () => workers);
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const task = (realm: "production" | "demo", worker: boolean) => runInDatabaseRealm(realm, () => {
    const action = async () => {
      const lease = target.connect();
      await barrier;
      return [target.query(), lease.name];
    };
    return worker ? runWithTrainingWorkerDatabase(action) : action();
  });
  const pending = [task("production", false), task("demo", false), task("production", true), task("demo", true)];
  assert.equal(target.query(), "request-production");
  release();
  assert.deepEqual(await Promise.all(pending), [
    ["request-production", "request-production"], ["request-demo", "request-demo"],
    ["worker-production", "worker-production"], ["worker-demo", "worker-demo"],
  ]);
  assert.equal(target.query(), "request-production");
});

test("missing demo worker fails closed without invoking production or request queries", () => {
  let requestCalls = 0;
  let productionCalls = 0;
  const target = createTrainingWorkerDispatcher(
    { query() { requestCalls++; } },
    () => createRealmDispatcher<{ query(): void }>(
      { query() { productionCalls++; } },
      () => { throw Error("Demo unavailable"); },
    ),
  );
  assert.throws(() => runInDatabaseRealm("demo", () => runWithTrainingWorkerDatabase(() => target.query())), /Demo unavailable/);
  assert.equal(requestCalls, 0);
  assert.equal(productionCalls, 0);
});

test("nested contexts and a rejected worker action do not leak worker selection", async () => {
  const target = createTrainingWorkerDispatcher(fakeDatabase("request"), () => fakeDatabase("worker"));
  await assert.rejects(runWithTrainingWorkerDatabase(async () => {
    assert.equal(target.query(), "worker");
    await runWithTrainingWorkerDatabase(async () => assert.equal(target.query(), "worker"));
    throw Error("expected failure");
  }), /expected failure/);
  assert.equal(target.query(), "request");
});

test("worker pools have bounded capacity/timeouts and preserve the supplied realm URL", () => {
  for (const realm of ["production", "demo"]) {
    const url = `postgres://unused/${realm}`;
    assert.deepEqual(trainingWorkerPoolConfig(url), {
      connectionString: url, max: 2, application_name: "vndrly-training-projections",
      statement_timeout: 60_000, connectionTimeoutMillis: 10_000,
    });
  }
});
