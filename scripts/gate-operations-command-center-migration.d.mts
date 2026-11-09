import type {GateCatalogClient,GateCatalogContract} from './gate-additive-catalog.mjs';
export function gateOperationsContract(sql:string):GateCatalogContract;
export function applyGateOperationsMigration(client:GateCatalogClient,sql:string):Promise<{applied:boolean;verified:true;backfilled?:boolean}>;
