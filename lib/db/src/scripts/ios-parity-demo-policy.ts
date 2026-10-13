type Identity = { name: string; address: string | null; port: number | null; started: string; role: string };
export function demoOwnerConnection(productionUrl: string, runtimeDemoUrl: string) {
  const production = new URL(productionUrl), runtime = new URL(runtimeDemoUrl);
  if (![production, runtime].every(url => ["postgres:", "postgresql:"].includes(url.protocol)) || runtime.pathname !== "/vndrly_prairie_demo" || production.pathname === runtime.pathname || production.username !== "postgres") throw Error("A distinct named demo and the existing database owner connection are required");
  const owner = new URL(production.href);
  owner.pathname = "/vndrly_prairie_demo";
  return owner.href;
}
export function assertDemoMigrationIdentity(production: Identity, runtime: Identity, owner: Identity) {
  const sameCluster = (a: Identity, b: Identity) => a.address === b.address && a.port === b.port && a.started === b.started;
  if (runtime.name !== "vndrly_prairie_demo" || owner.name !== runtime.name || production.name === owner.name || owner.role !== "postgres" || !sameCluster(production, owner) || !sameCluster(runtime, owner)) throw Error("Owner migration target must match the runtime demo in the same verified cluster and differ from production");
}
