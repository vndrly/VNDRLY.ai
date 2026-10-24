import { fileURLToPath as moveLocalPath } from 'node:url';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {loadVpsSshConfig} from './ssh-vps-config.mjs';
const {Client}=createRequire(import.meta.url)('ssh2');const c=new Client();await new Promise((ok,no)=>c.on('ready',ok).on('error',no).connect(loadVpsSshConfig()));
const sftp=await new Promise((ok,no)=>c.sftp((error,s)=>error?no(error):ok(s)));
const root='/var/www/vndrly/';
const read=path=>new Promise((ok,no)=>{let value='';const stream=sftp.createReadStream(root+path);stream.on('data',chunk=>value+=chunk);stream.on('error',no);stream.on('end',()=>ok(value));});
const put=(path,value)=>new Promise((ok,no)=>{const stream=sftp.createWriteStream(root+path);stream.on('error',no);stream.on('close',ok);stream.end(value);});
const run=command=>new Promise((ok,no)=>c.exec(command,(error,stream)=>{if(error)return no(error);stream.on('data',chunk=>process.stdout.write(chunk));stream.stderr.on('data',chunk=>process.stderr.write(chunk));stream.on('close',code=>code?no(Error('Scoped deployment failed '+code)):ok());}));
const stamp=Date.now(),folder='.local/company-operations-'+stamp;
try{
  const patches=[];
  let path='artifacts/api-server/src/routes/index.ts',value=await read(path);
  if(!value.includes('companyOperationsRouter')) value=value.replace('import onboardingRouter','import companyOperationsRouter from "./companyOperations";\nimport onboardingRouter').replace('router.use(onboardingRouter);','router.use(onboardingRouter);\nrouter.use(companyOperationsRouter);');
  if(!value.includes('router.use(companyOperationsRouter)'))throw Error('API mount anchor missing');patches.push([path,value]);
  path='artifacts/api-server/src/routes/onboarding.ts';value=await read(path);
  if(!value.includes('onboarding.operations_categories_required')){const anchor='  const acceptingUserId = session?.userId;';if(!value.includes(anchor))throw Error('Onboarding anchor missing');value=value.replace(anchor,anchor+'\n  if (orgType === "vendor") {\n    const rows = await db.execute(sql`SELECT operations_categories FROM vendors WHERE id = ${orgId}`);\n    if (!Array.isArray(rows.rows[0]?.operations_categories) || !(rows.rows[0]?.operations_categories as string[]).length) { res.status(400).json({ error: "Choose company operations before completing onboarding.", code: "onboarding.operations_categories_required" }); return; }\n  }');}patches.push([path,value]);
  path='artifacts/vndrly/src/pages/vendor-detail.tsx';value=await read(path);
  if(!value.includes('CompanyOperationsChoice')){const anchor='<Label>{t("vendors.companyName")}</Label>';const i=value.indexOf(anchor),div=value.lastIndexOf('<div',i);if(i<0||div<0)throw Error('Vendor modal anchor missing');value='import CompanyOperationsChoice from "@/components/company-operations-choice";\n'+value.slice(0,div)+'<CompanyOperationsChoice vendorId={id} />\n'+value.slice(div);}patches.push([path,value]);
  path='artifacts/vndrly/src/pages/onboarding-vendor.tsx';value=await read(path);
  if(!value.includes('CompanyOperationsChoice')){const anchor='          {currentStep.key === "company-basics" && (';if(!value.includes(anchor))throw Error('Vendor onboarding anchor missing');value='import CompanyOperationsChoice from "@/components/company-operations-choice";\n'+value.replace(anchor,'          {orgId ? <CompanyOperationsChoice key={orgId} /> : null}\n'+anchor);}patches.push([path,value]);
  path='artifacts/api-server/src/lib/demo-boundary.ts';value=await read(path);
  const anchor='export function demoRouteAllowed';
  if(!value.includes('/api/company-operations')){
    // Insert at the function body so it retains the existing realm boundary.
    const i=value.indexOf(anchor);if(i<0)throw Error('Demo boundary function missing');const brace=value.indexOf('{',value.indexOf(')',i));value=value.slice(0,brace+1)+'\n if(path === "/api/company-operations" && ["GET","PATCH"].includes(method)) return true;\n'+value.slice(brace+1);
  }patches.push([path,value]);
  await run(`cd ${root} && mkdir -p ${folder} && tar -czf ${folder}/before.tgz artifacts/api-server/src/routes/index.ts artifacts/api-server/src/routes/onboarding.ts artifacts/api-server/src/lib/demo-boundary.ts artifacts/vndrly/src/pages/vendor-detail.tsx artifacts/vndrly/src/pages/onboarding-vendor.tsx artifacts/api-server/dist artifacts/vndrly/dist/public`);
  for(const [path,value]of patches)await put(path,value);
  for(const path of ['artifacts/api-server/src/routes/companyOperations.ts','artifacts/vndrly/src/components/company-operations-choice.tsx'])await put(path,await readFile(path));
  await run(`cd ${root} && pnpm --filter @workspace/api-server run build && NODE_OPTIONS='--max-old-space-size=2048' BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/vndrly run build --outDir ${root+folder}/web && cp -a ${folder}/web/. artifacts/vndrly/dist/public/ && sudo systemctl restart vndrly-api`);
  await writeFile(moveLocalPath(new URL('../.local/company-operations-deployment.json', import.meta.url)),JSON.stringify({deployedAt:new Date().toISOString(),backup:folder+'/before.tgz',web:true,api:true},null,2));
}finally{c.end();}
