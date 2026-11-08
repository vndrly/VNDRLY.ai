import "../../../scripts/load-env-local.mjs";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../scripts/fresh-test-database.mjs";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import {createRealmDispatcher} from './database-realm';
import { createTrainingWorkerDispatcher, trainingWorkerPoolConfig } from './training-worker-database';
import {
  createResilientPostgresPool,
  type PostgresConnectionFailure,
} from "./pool-resilience";

if (process.env.VNDRLY_TEST_DB_MODE === "fresh-local") {
  assertFreshLocalTestDatabaseEnvironment(process.env);
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

function reportConnectionFailure(realm: "production" | "demo") {
  return ({ scope, error }: PostgresConnectionFailure) => {
    console.error(`[database:${realm}] ${scope} connection error`, error);
  };
}

const productionPool = createResilientPostgresPool(
  { connectionString: process.env.DATABASE_URL },
  reportConnectionFailure("production"),
);
const productionDb = drizzle(productionPool, { schema });
const demoPool = process.env.DEMO_DATABASE_URL
  ? createResilientPostgresPool(
      {connectionString:process.env.DEMO_DATABASE_URL,connectionTimeoutMillis:10000},
      reportConnectionFailure("demo"),
    )
  : null;
const demoDb = demoPool ? drizzle(demoPool,{schema}) : null;
// Independent pools preserve request capacity even while projection SQL is busy.
// Constructing a Pool does not open a connection; only explicit worker use does.
const productionTrainingPool = createResilientPostgresPool(
  trainingWorkerPoolConfig(process.env.DATABASE_URL),
  reportConnectionFailure("production"),
);
const productionTrainingDb = drizzle(productionTrainingPool, { schema });
const demoTrainingPool = process.env.DEMO_DATABASE_URL
  ? createResilientPostgresPool(
      trainingWorkerPoolConfig(process.env.DEMO_DATABASE_URL),
      reportConnectionFailure("demo"),
    )
  : null;
const demoTrainingDb = demoTrainingPool ? drizzle(demoTrainingPool, { schema }) : null;
let demoReady=false;
let demoInitialization:Promise<void>|undefined;

/** Validate actual server/database identity before accepting any demo request. */
export async function initializeDemoDatabase():Promise<void>{
 if(demoReady)return;
 if(!demoPool)throw Error('Demo database is not configured');
 if(!demoInitialization)demoInitialization=(async()=>{
  const sql="select current_database() name,host(inet_server_addr()) address,inet_server_port() port";
  const [production,demo]=await Promise.all([productionPool.query(sql),demoPool.query(sql)]);
  const a=production.rows[0],b=demo.rows[0];
  if(b.name!=='vndrly_prairie_demo'||JSON.stringify(a)===JSON.stringify(b))throw Error('Demo database identity is not distinct');
  const schemaReady=(await demoPool.query("select to_regclass('public.users') users,to_regclass('public.tickets') tickets")).rows[0];
  if(!schemaReady.users||!schemaReady.tickets)throw Error('Demo database schema is unavailable');
  demoReady=true;
 })().catch(error=>{demoInitialization=undefined;throw error;});
 return demoInitialization;
}

const requestPool=createRealmDispatcher(productionPool,()=>{
 if(!demoReady||!demoPool)throw Error('Demo database unavailable; production fallback prohibited');
 return demoPool;
});
const requestDb=createRealmDispatcher(productionDb,()=>{
 if(!demoReady||!demoDb)throw Error('Demo database unavailable; production fallback prohibited');
 return demoDb;
});
const trainingPool=createRealmDispatcher(productionTrainingPool,()=>{
 if(!demoReady||!demoTrainingPool)throw Error('Demo database unavailable; production fallback prohibited');
 return demoTrainingPool;
});
const trainingDb=createRealmDispatcher(productionTrainingDb,()=>{
 if(!demoReady||!demoTrainingDb)throw Error('Demo database unavailable; production fallback prohibited');
 return demoTrainingDb;
});
export const pool=createTrainingWorkerDispatcher(requestPool,()=>trainingPool);
export const db=createTrainingWorkerDispatcher(requestDb,()=>trainingDb);
export {runWithTrainingWorkerDatabase} from './training-worker-database';
export {currentDatabaseRealm,runInDatabaseRealm,assertExternalEffectsAllowed} from './database-realm';
export { withDatabaseTimings, timeDatabaseStage, startDatabaseStage } from './query-timings';
export type {DatabaseRealm} from './database-realm';

export * from "./schema";
export * from "./schema/workHubImports";
export * from "./format";
export * from "./sales-tax";
export * from "./ticket-tax-preview";
