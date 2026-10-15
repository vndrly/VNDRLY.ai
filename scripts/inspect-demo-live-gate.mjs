import {createRequire} from 'node:module';
import {loadVpsSshConfig} from './ssh-vps-config.mjs';
const {Client}=createRequire(import.meta.url)('ssh2');const c=new Client();
await new Promise((resolve,reject)=>{c.on('ready',resolve).on('error',reject).connect(loadVpsSshConfig());});
try{await new Promise((resolve,reject)=>c.exec("cd /var/www/vndrly && grep -R -n -C 10 'designated as a Gate contractor' artifacts/api-server/src",(err,stream)=>{if(err)return reject(err);stream.on('data',d=>process.stdout.write(d));stream.stderr.on('data',d=>process.stderr.write(d));stream.on('close',resolve);}));}finally{c.end();}

