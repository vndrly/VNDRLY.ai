import './load-env-local.mjs';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../lib/db/package.json',import.meta.url));
const {Client}=require('pg');
const client=new Client({connectionString:process.env.DATABASE_URL});
try {
 await client.connect();
 const tables=await client.query("select table_name from information_schema.tables where table_schema='public' and (table_name like '%demo%' or table_name like '%fleet%' or table_name like '%run%' or table_name in ('field_trips','assets','partners','vendors')) order by table_name");
 const orgs=await client.query("select 'partner' as kind,id,name from partners where name ilike '%demo%' or name ilike '%prairie horizon%' union all select 'vendor',id,name from vendors where name ilike '%demo%' or name ilike '%copper creek%' or name ilike '%blue horizon%' or name ilike '%sentinel prairie%'");
 const accounts=await client.query("select u.id,u.username,u.display_name,u.role,m.org_type,m.partner_id,m.vendor_id,m.role as membership_role from users u join user_org_memberships m on m.user_id=u.id where m.partner_id=609 or u.username like '%review%' or u.username like 'prairie-demo-%' order by u.id");
 const columns=await client.query("select table_name,string_agg(column_name||':'||data_type||case when is_nullable='NO' and column_default is null then ':required' else '' end,', ' order by ordinal_position) as columns from information_schema.columns where table_schema='public' and table_name in ('site_locations','tickets','assets','field_trips','work_hub_channels','work_hub_tasks','work_hub_events','partner_contacts','invoice_lines','invoice_ticket_links','notifications') group by table_name");
 console.log(JSON.stringify({tables:tables.rows,demoOrgs:orgs.rows,accounts:accounts.rows,columns:columns.rows}));
} finally {await client.end();}
