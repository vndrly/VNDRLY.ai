// Private keys include the signed-in user/membership and connected account.
export function readMailState<T>(storage: Storage, key: string): T | undefined {
  try { const entry = JSON.parse(storage.getItem(key) || "null");
    return entry && Date.now() - entry.savedAt < 7 * 86400000 ? entry.value : undefined;
  } catch { return undefined; }
}
export function writeMailState(storage: Storage, key: string, value: unknown): boolean {
  try { storage.setItem(key, JSON.stringify({savedAt:Date.now(),value})); return true; }
  catch { return false; }
}
export function replyAllRecipients(from:string, to:string[]=[], cc:string[]=[], self:string) {
  const extract=(value:string)=>value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[];
  const seen=new Set(extract(self).map(value=>value.toLowerCase()));
  const unique=(values:string[])=>values.flatMap(extract).filter(value=>{const key=value.toLowerCase();if(seen.has(key))return false;seen.add(key);return true;});
  return {to:unique([from,...to]).join(", "),cc:unique(cc).join(", ")};
}
