export interface GateMigrationClient { query(text:string,values?:unknown[]):Promise<{rows:any[]}>; }
export type GateMigrationCatalog = Record<'tables'|'columns'|'constraints'|'indexes'|'triggers'|'functions',Record<string,any>[]>;
export function assertAdditiveGateMigration(migration:string):void;
export function readGateMigrationCatalog(client:GateMigrationClient):Promise<GateMigrationCatalog>;
export function gateMigrationCatalogProblems(catalog:GateMigrationCatalog,migration:string):string[];
export function applyGateChangeOverMigration(client:GateMigrationClient,migration:string):Promise<{applied:boolean;verified:true}>;
