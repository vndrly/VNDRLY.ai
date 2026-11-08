import { AsyncLocalStorage } from 'node:async_hooks';
import { db } from '@workspace/db';
import { sql } from 'drizzle-orm';
import {gzipSync,gunzipSync} from 'node:zlib';
export const encodeTrainingProjection=(value:unknown)=>({encoding:'gzip-json-v1',data:gzipSync(JSON.stringify(value)).toString('base64')});
export function decodeTrainingProjection<T>(value:unknown):T{
 const record=value as {encoding?:string;data?:string};
 return (record?.encoding==='gzip-json-v1'?JSON.parse(gunzipSync(Buffer.from(record.data!,'base64')).toString('utf8')):value) as T;
}

const buildContext = new AsyncLocalStorage<Map<string, Promise<unknown>>>();
export function memoTrainingBuild<T>(key:string,compute:()=>Promise<T>):Promise<T>{
  const context=buildContext.getStore();if(!context)return compute();
  const namespaced=`internal:${key}`;
  if(!context.has(namespaced))context.set(namespaced,Promise.resolve().then(compute));
  return context.get(namespaced) as Promise<T>;
}

/** Only a scheduled worker may enter this context. Never call from a GET. */
export function buildStoredTrainingProjections<T>(work: () => Promise<T>): Promise<T> {
  return buildContext.run(new Map(), work);
}

/** A page read cannot calculate, enqueue, refresh, or invalidate a summary. */
export async function storedTrainingProjection<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const builds = buildContext.getStore();
  if (builds) {
    let pending = builds.get(key);
    if (!pending) {
      pending = (async () => {
        const value = await compute();
        await db.execute(sql`INSERT INTO training_read_projections (projection_key,payload,computed_at)
          VALUES (${key},${JSON.stringify(encodeTrainingProjection(value))}::jsonb,now())
          ON CONFLICT (projection_key) DO UPDATE SET payload=excluded.payload,computed_at=excluded.computed_at`);
        return value;
      })();
      builds.set(key, pending);
    }
    return pending as Promise<T>;
  }
  const result = await db.execute(sql`SELECT payload FROM training_read_projections WHERE projection_key=${key}`);
  if (!result.rows[0]) throw Object.assign(new Error('The saved training summary is being prepared.'), {status:503});
  return decodeTrainingProjection<T>((result.rows[0] as {payload:unknown}).payload);
}

export async function queueTrainingProjectionRefresh(ownerKey: string) {
  const owner = ownerKey.replace(/^(production|demo):/, '');
  if (!/^(vendor|partner):\d+$/.test(owner)) return;
  await db.execute(sql`INSERT INTO training_projection_queue(owner_key,requested_at) VALUES(${owner},now())
    ON CONFLICT(owner_key) DO UPDATE SET requested_at=excluded.requested_at`);
}
