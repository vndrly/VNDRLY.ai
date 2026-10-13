import { expect, it } from "vitest";
import { demoOwnerConnection, assertDemoMigrationIdentity } from "../../../../lib/db/src/scripts/ios-parity-demo-policy";
const production = { name: "postgres", address: "10.0.0.1", port: 5432, started: "2026-10-13", role: "postgres" };
const runtime = { ...production, name: "vndrly_prairie_demo", role: "demo_service" };
const owner = { ...runtime, role: "postgres" };
it("changes only the existing owner URL database path and never uses runtime credentials", () => {
  expect(demoOwnerConnection("postgresql://postgres:synthetic@database.invalid:5432/postgres?sslmode=require", "postgresql://demo_service:other@pooler.invalid:6543/vndrly_prairie_demo")).toBe("postgresql://postgres:synthetic@database.invalid:5432/vndrly_prairie_demo?sslmode=require");
  for (const [a,b] of [["postgresql://postgres:x@host/vndrly_prairie_demo", "postgresql://demo:x@host/vndrly_prairie_demo"], ["postgresql://service:x@host/postgres", "postgresql://demo:x@host/vndrly_prairie_demo"], ["postgresql://postgres:x@host/postgres", "postgresql://demo:x@host/wrong"]]) expect(() => demoOwnerConnection(a,b)).toThrow();
});
it("refuses production, another cluster, another demo or a non-owner target before DDL", () => {
  expect(() => assertDemoMigrationIdentity(production,runtime,owner)).not.toThrow();
  for (const changed of [{ name:"postgres" }, { name:"other_demo" }, { address:"10.0.0.2" }, { port:6543 }, { started:"another-cluster" }, { role:"demo_service" }]) expect(() => assertDemoMigrationIdentity(production,runtime,{...owner,...changed})).toThrow();
  expect(() => assertDemoMigrationIdentity(production,{...runtime,started:"another-cluster"},owner)).toThrow();
});
