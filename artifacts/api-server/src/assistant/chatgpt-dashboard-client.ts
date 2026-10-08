/** Compact host-pinning experiment. Never replaces the host conversation/composer. */
export const DASHBOARD_CLIENT = String.raw`
let dashboardHostContext={};
function updateDashboardHost(context){dashboardHostContext={...dashboardHostContext,...context};}
window.addEventListener('message',event=>{if(event.source===window.parent&&event.data?.method==='ui/notifications/host-context-changed')updateDashboardHost(event.data.params||{});});
function renderDashboard(output){
 if(output.view!=='my_workday') { document.body?.classList?.remove('dashboard-mode');return false; }
 document.body.classList.add('dashboard-mode');
 const content=el('content');content.replaceChildren();
 const strip=add(content,'section','','dashboard-strip');strip.setAttribute('aria-label','Organization workday dashboard');
 const brand=output.branding||{};
 const identity=add(strip,'div','','dashboard-identity');
 if(typeof brand.primaryColor==='string'&&/^#[0-9a-f]{6}$/i.test(brand.primaryColor))strip.style.borderTopColor=brand.primaryColor;
 if(typeof brand.logoUrl==='string'){
  const image=document.createElement('img');image.src=brand.logoUrl;image.alt=(brand.name||'Organization')+' logo';image.width=40;image.height=32;image.onerror=()=>image.remove();identity.append(image);
 }
 const label=add(identity,'div','');add(label,'strong',brand.name||'VNDRLY.ai');add(label,'small','My workday');
 const numbers=add(strip,'div','','dashboard-numbers');
 output.metrics.slice(0,4).forEach(item=>{const metric=add(numbers,'div','');add(metric,'strong',String(item.value));add(metric,'small',item.label);});
 const controls=add(strip,'div','','dashboard-controls');
 const pin=add(controls,'button','Pin');pin.type='button';
 const status=add(content,'p','','dashboard-status');status.setAttribute('role','status');
 const date=new Date(output.generatedAt);status.textContent='Updated '+(Number.isFinite(date.getTime())?date.toLocaleTimeString():'time unavailable')+' · Counts cover returned records';
 pin.onclick=async()=>{pin.disabled=true;try{
  const host=window.openai;
  const available=dashboardHostContext.availableDisplayModes;
  if(Array.isArray(available)&&!available.includes('pip'))throw Error('Pinning is unavailable in this ChatGPT client.');
  if(!Array.isArray(available)&&!host?.requestDisplayMode)throw Error('Pinning is unavailable in this ChatGPT client.');
  const granted=Array.isArray(available)?await request('ui/request-display-mode',{mode:'pip'}):await host.requestDisplayMode({mode:'pip'});
  const mode=granted?.mode||host?.displayMode;
  status.textContent=mode==='pip'?'Pinned by ChatGPT':mode==='fullscreen'?'ChatGPT opened fullscreen instead of pinning':mode==='inline'?'ChatGPT kept this dashboard inline':'Pin requested; host mode not confirmed';
 }catch(error){status.textContent=error.message;}finally{pin.disabled=false;}};
 const refresh=add(controls,'button','Refresh');refresh.type='button';refresh.onclick=()=>load('my_workday',true);
 const height=Math.ceil(document.body.getBoundingClientRect().height);
 window.openai?.notifyIntrinsicHeight?.(height);
 window.parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/size-changed',params:{height}},'*');
 return true;
}
setInterval(()=>{if(current?.view==='my_workday'&&!navigationPending&&document.visibilityState==='visible')load('my_workday',true);},30000);
if(typeof ResizeObserver==='function'){
 let lastHeight=0;
 new ResizeObserver(()=>{if(!document.body.classList.contains('dashboard-mode'))return;const height=Math.ceil(document.body.getBoundingClientRect().height);if(height===lastHeight)return;lastHeight=height;window.openai?.notifyIntrinsicHeight?.(height);window.parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/size-changed',params:{height}},'*');}).observe(document.body);
}
`;
export const DASHBOARD_CSS = String.raw`
body.dashboard-mode{padding:8px}body.dashboard-mode>header,body.dashboard-mode>nav,body.dashboard-mode>footer,body.dashboard-mode>#status:empty{display:none}
.dashboard-strip{display:flex;align-items:center;gap:18px;border-top:3px solid #27556a;padding:10px 8px;flex-wrap:wrap}
.dashboard-identity,.dashboard-numbers,.dashboard-controls{display:flex;align-items:center;gap:10px}.dashboard-identity img{object-fit:contain;max-width:72px}.dashboard-identity small,.dashboard-numbers small{display:block;font-size:11px;color:var(--color-text-secondary,#65717b)}.dashboard-identity strong{font-size:13px}.dashboard-numbers{gap:18px;flex:1}.dashboard-numbers strong{font-size:20px;font-variant-numeric:tabular-nums}.dashboard-controls button{font:inherit;font-size:12px;color:inherit;background:transparent;border:1px solid #999;border-radius:6px;padding:5px 8px}.dashboard-status{font-size:11px;color:var(--color-text-secondary,#65717b);margin:0 8px 3px}.dashboard-mode #status:not(:empty){font-size:11px;margin:3px 8px}
@media(max-width:450px){.dashboard-strip{gap:10px}.dashboard-controls{width:100%}.dashboard-numbers{gap:12px}}
`;
