/** Deploy only this task's exact patch, preserving unrelated VPS source. */
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {loadVpsSshConfig} from './ssh-vps-config.mjs';
const {Client}=createRequire(import.meta.url)('ssh2');
const eventsOnly=process.argv.includes('--events-only');
const modified=eventsOnly?['artifacts/api-server/src/lib/notification-events.ts','artifacts/api-server/src/work-hub/events.ts']:['lib/db/package.json','lib/db/src/index.ts','artifacts/api-server/src/app.ts','artifacts/api-server/src/lib/session.ts','artifacts/api-server/src/routes/auth.ts','artifacts/api-server/src/lib/sendgrid.ts','artifacts/api-server/src/lib/twilio.ts','artifacts/api-server/src/lib/expo-push.ts','artifacts/api-server/src/assistant/chatgpt-grant-store.ts'];
const added=eventsOnly?[]:['lib/db/src/database-realm.ts','artifacts/api-server/src/lib/demo-identities.ts','artifacts/api-server/src/lib/demo-boundary.ts','artifacts/api-server/src/lib/demo-request-boundary.ts'];
const patch=execFileSync('git',['diff','--binary','--',...modified.filter(f=>f!=='artifacts/api-server/src/app.ts')],{encoding:'utf8'});
if(!patch.includes(eventsOnly?'currentDatabaseRealm':'initializeDemoDatabase'))throw Error('Expected isolation patch missing');
const c=new Client();await new Promise((resolve,reject)=>c.on('ready',resolve).on('error',reject).connect(loadVpsSshConfig()));
const run=command=>new Promise((resolve,reject)=>c.exec(command,(error,stream)=>{
 if(error)return reject(error);let out='';stream.on('data',d=>{out+=d;process.stdout.write(d)});stream.stderr.on('data',d=>{out+=d;process.stderr.write(d)});stream.on('close',code=>code?reject(Error(`Remote step failed (${code})`)):resolve(out));
}));
const sftp=await new Promise((resolve,reject)=>c.sftp((e,s)=>e?reject(e):resolve(s)));
const upload=(path,content)=>new Promise((resolve,reject)=>{const stream=sftp.createWriteStream(path,{mode:0o600});stream.on('error',reject).on('close',resolve);stream.end(content);});
const download=path=>new Promise((resolve,reject)=>{const chunks=[];const stream=sftp.createReadStream(path);stream.on('data',d=>chunks.push(d));stream.on('error',reject).on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));});
const stamp=new Date().toISOString().replace(/[^0-9]/g,'');
const root='/var/www/vndrly';
try{
 await run(`cd ${root} && mkdir -p .local/demo-isolation-${stamp}`);
 await upload(`${root}/.local/demo-isolation-${stamp}/changes.patch`,patch);
 if(!eventsOnly)await run(`cd ${root} && git apply --check .local/demo-isolation-${stamp}/changes.patch`);
 const eventFiles=[];
 if(eventsOnly)for(const file of modified){
  let text=await download(`${root}/${file}`);
  const replacements=file.endsWith('notification-events.ts')?
   [[`import { logger } from "./logger";`,`\nimport {currentDatabaseRealm} from '@workspace/db/realm';`],[`function publishNotificationEvent(ev: NotificationEvent): void {`,`\n  if(currentDatabaseRealm()==='demo')return;`]]:
   [[`import type { WorkHubContextRef, WorkHubEventEnvelope, WorkHubOwner } from "@workspace/api-zod";`,`\nimport {currentDatabaseRealm} from '@workspace/db/realm';`],[` }): WorkHubEventEnvelope[] {`,`\n  if(currentDatabaseRealm()==='demo')return [];`]];
  if(file.endsWith('/events.ts'))replacements[1][0]=`}): WorkHubEventEnvelope[] {`;
  for(const [anchor,addition] of replacements){if(text.split(anchor).length!==2)throw Error('Expected unique event boundary anchor');text=text.replace(anchor,anchor+addition);}eventFiles.push([file,text]);
 }
 let app=eventsOnly?'':await download(`${root}/artifacts/api-server/src/app.ts`);
 for(const [anchor,addition] of [[`import assistantConnectionRouter from "./routes/assistantConnection";`,`\nimport {demoRequestBoundary} from './lib/demo-request-boundary';`],[`app.use(express.urlencoded({ extended: true, limit: "1mb" }));`,`\napp.use(demoRequestBoundary);`]]){
  if(eventsOnly)continue;
  if(app.split(anchor).length!==2)throw Error('Expected unique application boundary anchor');app=app.replace(anchor,anchor+addition);
 }
 if(!process.argv.includes('--apply')){console.log('Patch preflight passed; deployment not applied.');}
 else{
  await run(`cd ${root} && tar -czf .local/demo-isolation-${stamp}/before.tgz ${modified.join(' ')} .env.production artifacts/api-server/dist`);
  if(!eventsOnly)await run(`cd ${root} && git apply .local/demo-isolation-${stamp}/changes.patch`);
  for(const [file,text] of eventFiles)await upload(`${root}/${file}`,text);
  if(!eventsOnly)await upload(`${root}/artifacts/api-server/src/app.ts`,app);
  for(const file of added)await upload(`${root}/${file}`,await readFile(file));
  const access=JSON.parse(await readFile('.local/prairie-demo-database-access.json','utf8'));
  if(!access.verifiedAt||new URL(access.url).pathname!=='/vndrly_prairie_demo')throw Error('Dedicated demo credential not verified');
  await upload(`${root}/.local/demo-isolation-${stamp}/access.json`,JSON.stringify({url:access.url}));
  const configure=String.raw`import {readFileSync,writeFileSync} from 'node:fs';const file='.env.production';const text=readFileSync(file,'utf8');const access=JSON.parse(readFileSync(new URL('./access.json',import.meta.url),'utf8'));const url=new URL(access.url);if(url.pathname!=='/vndrly_prairie_demo')throw Error('Invalid demo database');const expected='DEMO_DATABASE_URL='+url.toString();const existing=text.split(/\r?\n/).find(x=>x.startsWith('DEMO_DATABASE_URL='));if(existing&&existing!==expected)throw Error('Demo configuration already differs; refusing overwrite');if(!existing)writeFileSync(file,text.trimEnd()+'\n'+expected+'\n',{mode:0o600});console.log('Dedicated demo database configuration installed');`;
  await upload(`${root}/.local/demo-isolation-${stamp}/configure.mjs`,configure);
  await run(`cd ${root} && node .local/demo-isolation-${stamp}/configure.mjs && pnpm --filter @workspace/api-server run build && sudo systemctl restart vndrly-api && curl --fail --silent --show-error --retry 8 --retry-delay 2 https://vndrly.ai/api/healthz`);
  await writeFile('.local/prairie-demo-api-deployment.json',JSON.stringify({deployedAt:new Date().toISOString(),backup:`.local/demo-isolation-${stamp}/before.tgz`,files:[...modified,...added],health:true},null,2));
 }
}finally{c.end();}
