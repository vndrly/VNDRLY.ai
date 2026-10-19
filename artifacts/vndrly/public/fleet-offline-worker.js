/* Fleet-only public application shell. API responses, credentials, documents,
 * user records and private images never enter the service-worker cache. */
const CACHE="vndrly-fleet-public-shell-v2";
const fleet=url=>url.origin===self.location.origin&&(url.pathname==="/fleet"||url.pathname.startsWith("/fleet/"));
const asset=url=>url.origin===self.location.origin&&url.pathname.startsWith("/assets/")&&!url.pathname.includes("%")&&/\.(?:js|css|woff2?|ttf|png|webp|jpe?g|svg)$/i.test(url.pathname);
self.addEventListener("install",event=>event.waitUntil(self.skipWaiting()));
self.addEventListener("activate",event=>event.waitUntil(self.clients.claim()));
self.addEventListener("message",event=>{
 if(event.data?.kind!=="PROVISION_FLEET_SHELL"||!event.ports?.[0])return;
 event.waitUntil((async()=>{try{
  const client=event.source?.id?await self.clients.get(event.source.id):null;
  if(!client||!fleet(new URL(client.url))||!Array.isArray(event.data.assets)||event.data.assets.length>1500)throw Error("Invalid Fleet shell request");
  const urls=[...new Set(event.data.assets.map(value=>new URL(value,self.location.origin).href))];
  if(!urls.length||urls.some(value=>!asset(new URL(value))))throw Error("Only public application assets may be provisioned");
  const cache=await caches.open(CACHE),shell=await fetch(new Request("/fleet",{credentials:"omit",cache:"reload"}));
  if(!shell.ok||shell.redirected||!shell.headers.get("content-type")?.includes("text/html"))throw Error("Fleet application shell unavailable");
  await cache.put("/fleet",shell);
  for(const url of urls){const response=await fetch(new Request(url,{credentials:"omit",cache:"reload"}));if(!response.ok||response.redirected||response.headers.get("content-type")?.includes("text/html")||response.headers.get("content-type")?.includes("application/json"))throw Error("Public application asset unavailable");await cache.put(url,response);}
  event.ports[0].postMessage({ready:true,assetCount:urls.length});
 }catch(error){event.ports[0].postMessage({ready:false,reason:error instanceof Error?error.message:"Offline shell unavailable"});}})());
});
self.addEventListener("fetch",event=>{
 const request=event.request;if(request.method!=="GET")return;const url=new URL(request.url);
 if(request.mode==="navigate"&&fleet(url)){event.respondWith(fetch(request).catch(async()=>{const cached=await (await caches.open(CACHE)).match("/fleet");if(!cached)throw Error("Fleet shell was not provisioned");return cached;}));return;}
 if(asset(url))event.respondWith((async()=>await (await caches.open(CACHE)).match(request)??fetch(request))());
});
