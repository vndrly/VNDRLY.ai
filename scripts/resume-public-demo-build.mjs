/** Retry only a failed staged web build, using its existing source backup. */
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {loadVpsSshConfig} from './ssh-vps-config.mjs';
const folder=process.argv[2];if(!/^\.local\/public-demo-\d+$/.test(folder||''))throw Error('Exact deployment folder required');
const {Client}=createRequire(import.meta.url)('ssh2'),c=new Client();await new Promise((ok,no)=>c.on('ready',ok).on('error',no).connect(loadVpsSshConfig()));
const uiOnly=process.argv.includes('--fix-flyout');
if(uiOnly||process.argv.includes('--fix-cached-lookup')){
 const sf=await new Promise((ok,no)=>c.sftp((e,s)=>e?no(e):ok(s)));
 for(const file of (uiOnly?['artifacts/vndrly/src/components/demo-entry.tsx']:['artifacts/vndrly/src/components/demo-entry.tsx','artifacts/vndrly/src/components/demo-guide.tsx','artifacts/api-server/src/lib/demo-boundary.ts'])){
  const content=await readFile(file);await new Promise((ok,no)=>{const s=sf.createWriteStream('/var/www/vndrly/'+file,{mode:0o644});s.on('error',no).on('close',ok);s.end(content);});
 }
 if(!uiOnly) await new Promise((ok,no)=>c.exec('cd /var/www/vndrly && pnpm --filter @workspace/api-server run build',(e,s)=>{if(e)return no(e);s.on('data',d=>process.stdout.write(d));s.stderr.on('data',d=>process.stderr.write(d));s.on('close',code=>code?no(Error('API boundary build failed')):ok());}));
}
try{await new Promise((ok,no)=>c.exec(`cd /var/www/vndrly && test -f ${folder}/before.tgz && NODE_OPTIONS='--max-old-space-size=2048' BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/vndrly run build --outDir /var/www/vndrly/${folder}/web && cp -a ${folder}/web/. artifacts/vndrly/dist/public/ ${uiOnly?'':'&& sudo systemctl restart vndrly-api'}`,(e,s)=>{if(e)return no(e);s.on('data',d=>process.stdout.write(d));s.stderr.on('data',d=>process.stderr.write(d));s.on('close',code=>code?no(Error(`Web retry failed ${code}`)):ok());}));await writeFile('.local/public-demo-deployment.json',JSON.stringify({deployedAt:new Date().toISOString(),backup:folder+'/before.tgz',web:true,api:true},null,2));}finally{c.end();}
