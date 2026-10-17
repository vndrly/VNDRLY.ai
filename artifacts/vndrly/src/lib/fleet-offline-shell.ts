export type FleetOfflineCapability={status:"durable_ready";persisted:true;assetCount:number}|{status:"unavailable";reason:string};
/** Provision only an owned Fleet scope. A root worker or unprotected storage
 * cannot be reported as equivalent to the native encrypted offline store. */
export async function provisionFleetOfflineShell(options={production:import.meta.env.PROD}):Promise<FleetOfflineCapability>{
 try{
  if(!options.production)return {status:"unavailable",reason:"Offline reload requires a production web build"};
  if(!navigator.serviceWorker||!navigator.storage?.persist)return {status:"unavailable",reason:"This browser cannot provision protected offline work"};
  const persisted=await navigator.storage.persisted?.()||await navigator.storage.persist();if(!persisted)return {status:"unavailable",reason:"Browser eviction protection was not granted; durable offline reload is unavailable"};
  const registrations=await navigator.serviceWorker.getRegistrations();
  if(registrations.some(reg=>new URL(reg.scope).pathname==="/"||new URL(reg.scope).pathname.startsWith("/fleet")&&![reg.active,reg.installing,reg.waiting].some(worker=>worker?.scriptURL===new URL("/fleet-offline-worker.js",location.origin).href)))return {status:"unavailable",reason:"An existing service worker overlaps the Fleet offline scope"};
  const assets=[...new Set([...performance.getEntriesByType("resource").map(entry=>entry.name),...Array.from(document.querySelectorAll("script[src],link[rel='stylesheet']")).map(node=>node.getAttribute("src")??node.getAttribute("href")??"")].map(value=>new URL(value,location.href)).filter(url=>url.origin===location.origin&&url.pathname.startsWith("/assets/")&&!url.pathname.includes("%")&&/\.(js|css|woff2?|ttf|png|webp|jpe?g|svg)$/i.test(url.pathname)).map(url=>url.href))];
  if(!assets.some(url=>new URL(url).pathname.endsWith(".js")))return {status:"unavailable",reason:"The production Fleet application assets are not loaded"};
  const registration=await navigator.serviceWorker.register("/fleet-offline-worker.js",{scope:"/fleet"});let worker=registration.active??registration.installing??registration.waiting;if(!worker)throw Error("Fleet worker is unavailable");
  if(worker.state!=="activated")await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error("Fleet worker activation timed out")),10000);worker!.addEventListener("statechange",()=>{if(worker!.state==="activated"){clearTimeout(timer);resolve();}else if(worker!.state==="redundant"){clearTimeout(timer);reject(Error("Fleet worker activation failed"));}});});
  worker=registration.active??worker;
  const result=await new Promise<{ready:boolean;assetCount:number;reason?:string}>((resolve,reject)=>{const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();reject(Error("Fleet shell acknowledgement timed out"));},30000);channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();resolve(event.data);};worker!.postMessage({kind:"PROVISION_FLEET_SHELL",assets},[channel.port2]);});
  return result.ready?{status:"durable_ready",persisted:true,assetCount:result.assetCount}:{status:"unavailable",reason:result.reason??"Fleet shell was not verified"};
 }catch(error){return {status:"unavailable",reason:error instanceof Error?error.message:"Fleet offline provision failed"};}
}
