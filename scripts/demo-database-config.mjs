import {readFile} from 'node:fs/promises';
export function resolveDemoDatabaseUrl(env,saved){
 const value=env.DEMO_DATABASE_URL??saved?.url;
 if(!value)throw Error('Isolated demo database not configured; production fallback prohibited');
 const url=new URL(value);
 if(!['postgres:','postgresql:'].includes(url.protocol)||url.pathname!=='/vndrly_prairie_demo')throw Error('Wrong demo database; production writes prohibited');
 return url.toString();
}
export async function demoDatabaseUrl(){
 let saved;
 if(!process.env.DEMO_DATABASE_URL)try{saved=JSON.parse(await readFile(new URL('../.local/prairie-demo-database-access.json',import.meta.url),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 return resolveDemoDatabaseUrl(process.env,saved);
}
