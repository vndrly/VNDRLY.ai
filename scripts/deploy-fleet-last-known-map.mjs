import{createRequire}from'node:module';
import{spawnSync}from'node:child_process';
import{writeFile}from'node:fs/promises';
import{loadVpsSshConfig}from'./ssh-vps-config.mjs';
const files=['artifacts/api-server/src/services/fleet-location.ts'];
const diff=spawnSync('git',['diff','--',...files],{encoding:'utf8'});if(diff.status||!diff.stdout)throw Error('Exact API patch unavailable');
const{Client}=createRequire(import.meta.url)('ssh2');const c=new Client();await new Promise((ok,no)=>c.on('ready',ok).on('error',no).connect(loadVpsSshConfig()));
const run=command=>new Promise((ok,no)=>c.exec(command,(error,stream)=>{if(error)return no(error);stream.on('data',chunk=>process.stdout.write(chunk));stream.stderr.on('data',chunk=>process.stderr.write(chunk));stream.on('close',code=>code?no(Error('Workday deployment failed '+code)):ok());}));
const folder='.local/askv-workday-'+Date.now();
try{
 await run('cd /var/www/vndrly && mkdir -p '+folder);
 const sf=await new Promise((ok,no)=>c.sftp((error,s)=>error?no(error):ok(s)));
 await new Promise((ok,no)=>{const stream=sf.createWriteStream('/var/www/vndrly/'+folder+'/api.patch');stream.on('error',no).on('close',ok);stream.end(diff.stdout);});
 await run(`cd /var/www/vndrly && git apply --check ${folder}/api.patch && tar -czf ${folder}/before.tgz ${files.join(' ')} artifacts/api-server/dist && git apply ${folder}/api.patch && pnpm --filter @workspace/api-server run build && sudo systemctl restart vndrly-api`);
 await writeFile('C:/Users/JohnElerick/DEV/VNDRLY.ai/.local/askv-workday-deployment.json',JSON.stringify({deployedAt:new Date().toISOString(),backup:folder+'/before.tgz',api:true},null,2));
}finally{c.end();}
