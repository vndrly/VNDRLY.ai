export type GateCatalogClient={query(sql:string,values?:unknown[]):Promise<{rows:any[]}>};
export type GateCatalogContract={columns:Record<string,Record<string,{type:string;notNull:boolean;defaultValue?:string}>>;constraints?:any[];indexes?:any[];rls?:string[]};
export type GateCatalog={tables:any[];columns:any[];constraints:any[];indexes:any[]};
export function readAdditiveCatalog(client:GateCatalogClient,contract:GateCatalogContract):Promise<GateCatalog>;
export function additiveCatalogProblems(catalog:GateCatalog,contract:GateCatalogContract):string[];
export function contractFromGateOperationsSql(sql:string):GateCatalogContract;
