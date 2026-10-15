/** Scoped web/API publication; preserves unrelated live source and credentials. */
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {loadVpsSshConfig} from './ssh-vps-config.mjs';
const {Client}=createRequire(import.meta.url)('ssh2');
const root='/var/www/vndrly',stamp=new Date().toISOString().replace(/[^0-9]/g,''),folder=`.local/public-demo-${stamp}`;
const c=new Client();await new Promise((ok,no)=>c.on('ready',ok).on('error',no).connect(loadVpsSshConfig()));
const run=cmd=>new Promise((ok,no)=>c.exec(cmd,(e,s)=>{if(e)return no(e);let out='';s.on('data',d=>{out+=d;process.stdout.write(d)});s.stderr.on('data',d=>{out+=d;process.stderr.write(d)});s.on('close',code=>code?no(Error(`Remote step failed ${code}`)):ok(out));}));
const sf=await new Promise((ok,no)=>c.sftp((e,s)=>e?no(e):ok(s)));
const download=p=>new Promise((ok,no)=>{const chunks=[],s=sf.createReadStream(`${root}/${p}`);s.on('data',d=>chunks.push(d)).on('error',no).on('end',()=>ok(Buffer.concat(chunks).toString('utf8')));});
const upload=(p,content)=>new Promise((ok,no)=>{const s=sf.createWriteStream(`${root}/${p}`,{mode:0o644});s.on('error',no).on('close',ok);s.end(content);});
function replace(text,anchor,value){if(text.split(anchor).length!==2)throw Error(`Nonunique deployment anchor: ${anchor.slice(0,70)}`);return text.replace(anchor,value);}
const newFiles=['artifacts/api-server/src/lib/public-demo.ts','artifacts/vndrly/src/components/demo-entry.tsx','artifacts/vndrly/src/components/demo-guide.tsx','artifacts/vndrly/src/lib/demo-guide.ts'];
const copies=['artifacts/api-server/src/lib/demo-boundary.ts','artifacts/api-server/src/lib/demo-request-boundary.ts'];
const transformed=new Map();
try{
 let file='artifacts/api-server/src/routes/auth.ts',s=await download(file);
 s=replace(s,"import {currentDatabaseRealm} from '@workspace/db/realm';","import {currentDatabaseRealm} from '@workspace/db/realm';\nimport {publicDemoAccount} from '../lib/public-demo';\nimport {getDefaultBucketStore} from '../lib/bucket-store';");
 s=replace(s,'  ctx: ResolvedContext,\n','  ctx: ResolvedContext,\n  publicDemo = false,\n');
 s=replace(s,'      realm: currentDatabaseRealm(),','      realm: currentDatabaseRealm(),\n      publicDemo,');
 s=replace(s,'      exp: nowSecs + SESSION_TTL_SECS,','      exp: nowSecs + (publicDemo ? 2*60*60 : SESSION_TTL_SECS),');
 const local=await readFile(file,'utf8'),start=local.indexOf("router.post('/auth/demo-entry'"),end=local.indexOf('router.post("/auth/login"',start);
 if(start<0||end<0)throw Error('Public handler missing');
 s=replace(s,'router.post("/auth/login",',local.slice(start,end)+'router.post("/auth/login",');transformed.set(file,s);
 file='artifacts/api-server/src/app.ts';s=await download(file);s=replace(s,'const SESSION_VERSION_SKIP: { method: string; pattern: RegExp }[] = [','const SESSION_VERSION_SKIP: { method: string; pattern: RegExp }[] = [\n  { method: "POST", pattern: /^\\/api\\/auth\\/demo-entry$/ },');transformed.set(file,s);
 file='artifacts/api-server/src/lib/publicApiAllowlist.ts';s=await download(file);for(const name of ['GUEST_ALLOWLIST','PUBLIC_UNAUTHENTICATED_ALLOWLIST']){const anchor=`export const ${name}: ApiAllowRule[] = [`;s=replace(s,anchor,anchor+'\n  { method: "POST", pattern: /^\\/api\\/auth\\/demo-entry$/ },');}transformed.set(file,s);
 file='artifacts/api-server/src/lib/session.ts';s=await download(file);s=replace(s,"  realm?: 'production'|'demo';","  realm?: 'production'|'demo';\n  publicDemo?: boolean;");transformed.set(file,s);
 file='artifacts/vndrly/src/App.tsx';s=await download(file);s=replace(s,'import ContextPickerModal from','import DemoGuide from "@/components/demo-guide";\nimport ContextPickerModal from');s=replace(s,'{user && <ContextPickerModal />}','{user && <DemoGuide />}\n      {user && <ContextPickerModal />}');transformed.set(file,s);
 file='artifacts/vndrly/src/pages/marketing-home.tsx';s=await download(file);s=replace(s,'import PublicAskV from','import DemoEntry from "@/components/demo-entry";\nimport PublicAskV from');let count=0;s=s.replace(/<a href=\{marketingDemoHref\} data-testid="marketing-demo-cta".*?<\/a>/g,()=>{count++;return '<DemoEntry />'});if(count!==2)throw Error('Expected two public demo CTAs');s=replace(s,'<a href={marketingDemoHref} className="hover:text-[var(--vndrly-amber)]">Request a demo</a>','<DemoEntry />');transformed.set(file,s);
 await run(`cd ${root} && mkdir -p ${folder}`);
 for(const [file,text] of transformed)await writeFile(`.local/public-demo-remote-${file.replaceAll('/','_')}`,text);
 if(!process.argv.includes('--apply')){console.log('All scoped deployment anchors verified. No live changes applied.');}
 else{
  await run(`cd ${root} && tar -czf ${folder}/before.tgz ${[...transformed.keys(),...copies].join(' ')} artifacts/api-server/dist artifacts/vndrly/dist/public`);
  for(const [file,text] of transformed)await upload(file,text);
  for(const file of [...newFiles,...copies])await upload(file,await readFile(file));
  await run(`cd ${root} && pnpm --filter @workspace/api-server run build && NODE_OPTIONS='--max-old-space-size=2048' BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/vndrly run build --outDir ${root}/${folder}/web`);
  await run(`cd ${root} && cp -a ${folder}/web/. artifacts/vndrly/dist/public/ && sudo systemctl restart vndrly-api`);
  await writeFile('.local/public-demo-deployment.json',JSON.stringify({deployedAt:new Date().toISOString(),backup:folder+'/before.tgz',files:[...transformed.keys(),...newFiles,...copies]},null,2));
 }
}finally{c.end();}
