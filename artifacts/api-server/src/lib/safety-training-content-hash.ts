import {createHash}from'node:crypto';
function canonicalValue(value:unknown):unknown{
 if(Array.isArray(value))return value.map(canonicalValue);
 if(value!==null&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalValue((value as Record<string,unknown>)[key])]));
 return value;
}
/** Postgres jsonb reorders object keys. Question/lesson arrays retain order,
 * while answer-explanation record key order must not change course identity. */
export function safetyTrainingContentHash(content:unknown){
 return createHash('sha256').update(JSON.stringify(canonicalValue(content))).digest('hex');
}
