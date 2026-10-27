import "../../../scripts/load-env-local.mjs";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../scripts/fresh-test-database.mjs";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import {createRealmDispatcher} from './database-realm';
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

export const pool=createRealmDispatcher(productionPool,()=>{
 if(!demoReady||!demoPool)throw Error('Demo database unavailable; production fallback prohibited');
 return demoPool;
});
export const db=createRealmDispatcher(productionDb,()=>{
 if(!demoReady||!demoDb)throw Error('Demo database unavailable; production fallback prohibited');
 return demoDb;
});
export {currentDatabaseRealm,runInDatabaseRealm,assertExternalEffectsAllowed} from './database-realm';
export type {DatabaseRealm} from './database-realm';

export * from "./schema";
export * from "./schema/workHubImports";
export * from "./format";
export * from "./sales-tax";
export * from "./ticket-tax-preview";
