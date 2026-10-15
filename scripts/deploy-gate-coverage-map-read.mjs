import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {loadVpsSshConfig} from './ssh-vps-config.mjs';
const {Client}=createRequire(import.meta.url)('ssh2'),c=new Client();
await new Promise((ok,no)=>c.on('ready',ok).on('error',no).connect(loadVpsSshConfig()));
const dir='.local/gate-coverage-read-'+Date.now();
const run=command=>new Promise((ok,no)=>c.exec(command,(e,s)=>{if(e)return no(e);s.on('data',d=>process.stdout.write(d));s.stderr.on('data',d=>process.stderr.write(d));s.on('close',code=>code?no(Error('Coverage read deploy failed')):ok());}));
try {
 await run('cd /var/www/vndrly && mkdir -p '+dir+' && tar -czf '+dir+'/before.tgz artifacts/api-server/src/routes/gateChangeOver.ts artifacts/api-server/dist');
 const sf=await new Promise((ok,no)=>c.sftp((e,s)=>e?no(e):ok(s)));
 const put=(path,data)=>new Promise((ok,no)=>{const stream=sf.createWriteStream('/var/www/vndrly/'+path);stream.on('error',no).on('close',ok);stream.end(data);});
 for(const name of ['gate-coverage-map.ts','gate-post-policy.ts'])await put('artifacts/api-server/src/services/'+name,readFileSync(new URL('../artifacts/api-server/src/services/'+name,import.meta.url)));
 const route='router.get("/gate-change-over/coverage-map",async(req,res)=>{const at=req.query.at===undefined?new Date():new Date(z.string().datetime().parse(req.query.at));if(at.getTime()>Date.now()+30000||at.getTime()<Date.now()-365*86400000){res.status(400).json({error:"Choose a time within the past year."});return;}res.json(await readGateCoverageMap(sessionFor(req),at));});';
 const patch=`import fs from 'node:fs';const p='artifacts/api-server/src/routes/gateChangeOver.ts';let s=fs.readFileSync(p,'utf8');if(!s.includes('readGateCoverageMap')){const anchor='router.get("/gate-change-over/map"';if(!s.includes(anchor))throw Error('Route anchor missing');s='import {readGateCoverageMap} from "../services/gate-coverage-map";\\n'+s.replace(anchor,${JSON.stringify(route+String.fromCharCode(10))}+anchor);fs.writeFileSync(p,s);}`;
 await put(dir+'/patch.mjs',patch);
 await run('cd /var/www/vndrly && node '+dir+'/patch.mjs && pnpm --filter @workspace/api-server build && sudo systemctl restart vndrly-api');
} finally {c.end();}
