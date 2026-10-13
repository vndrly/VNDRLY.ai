import {AsyncLocalStorage} from 'node:async_hooks';

export type DatabaseRealm='production'|'demo';
const context=new AsyncLocalStorage<DatabaseRealm>();
/** Background work has no request context and always defaults to production. */
export function currentDatabaseRealm():DatabaseRealm{return context.getStore()??'production';}
export function runInDatabaseRealm<T>(realm:DatabaseRealm,action:()=>T):T{
 if(realm!=='production'&&realm!=='demo')throw Error('Invalid database realm');
 return context.run(realm,action);
}
export function assertExternalEffectsAllowed():void{
 if(currentDatabaseRealm()==='demo')throw Error('External effects disabled for isolated demo');
}
/** Resolve each operation locally; never change a shared connection setting. */
export function createRealmDispatcher<T extends object>(production:T,demo:()=>T):T{
 return new Proxy(production,{
  get(_target,property){
   const target=currentDatabaseRealm()==='demo'?demo():production;
   const value=Reflect.get(target,property,target);
   return typeof value==='function'?value.bind(target):value;
  },
 });
}
