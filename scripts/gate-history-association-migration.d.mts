import type {GateCatalogClient,GateCatalogContract} from './gate-additive-catalog.mjs';
export const gateHistoryAssociationStatements:string[];
export const gateHistoryAssociationContract:GateCatalogContract;
export function migrateGateHistoryAssociations(client:GateCatalogClient):Promise<{applied:boolean;verified:true}>;
