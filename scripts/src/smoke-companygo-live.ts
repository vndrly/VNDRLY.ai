const BASE = process.env.SMOKE_BASE_URL ?? "https://vndrly.ai";
const PASSWORD = "companygo";
const calendarStart = new Date(Date.now()-30*86_400_000).toISOString();
const calendarEnd = new Date(Date.now()+8*86_400_000).toISOString();
const calendar = `/api/work-hub/calendar?start=${encodeURIComponent(calendarStart)}&end=${encodeURIComponent(calendarEnd)}`;

const roles: Record<string, string[]> = {
  "partner_admin@gasgo.com": ["/api/auth/me","/api/tickets","/api/invoices","/api/visits","/api/work-hub/home","/api/work-hub/tasks",calendar,"/api/work-hub/channels"],
  "partner_office@gasgo.com": ["/api/auth/me","/api/tickets","/api/invoices","/api/visits","/api/work-hub/home","/api/work-hub/tasks",calendar,"/api/work-hub/channels"],
  "partner_foreman@gasgo.com": ["/api/auth/me","/api/tickets","/api/visits","/api/work-hub/home","/api/work-hub/tasks",calendar,"/api/work-hub/channels"],
  "vendor_admin@fieldgo.com": ["/api/auth/me","/api/tickets","/api/invoices","/api/field-employees","/api/work-hub/home","/api/work-hub/tasks",calendar,"/api/work-hub/channels"],
  "vendor_office@fieldgo.com": ["/api/auth/me","/api/tickets","/api/invoices","/api/field-employees","/api/work-hub/home","/api/work-hub/tasks",calendar,"/api/work-hub/channels"],
  "vendor_foreman@fieldgo.com": ["/api/auth/me","/api/field/sites","/api/field/open-tickets","/api/work-hub/home","/api/work-hub/tasks",calendar,"/api/work-hub/channels"],
  "vendor_field@fieldgo.com": ["/api/auth/me","/api/field/sites","/api/field/open-tickets","/api/work-hub/home","/api/work-hub/tasks",calendar,"/api/work-hub/channels"],
  "vendor_admin@fleetgo.com": ["/api/auth/me","/api/tickets","/api/invoices","/api/implementation-a/trips","/api/implementation-a/trips/active","/api/work-hub/home",calendar],
  "vendor_office@fleetgo.com": ["/api/auth/me","/api/tickets","/api/invoices","/api/implementation-a/trips","/api/implementation-a/trips/active","/api/work-hub/home",calendar],
  "vendor_fleet_dispatch@fleetgo.com": ["/api/auth/me","/api/tickets","/api/implementation-a/trips","/api/implementation-a/trips/active","/api/work-hub/home",calendar],
  "vendor_fleet_driver@fleetgo.com": ["/api/auth/me","/api/field/sites","/api/field/open-tickets","/api/implementation-a/trips","/api/implementation-a/trips/active","/api/work-hub/home",calendar],
  "vendor_admin@gatego.com": ["/api/auth/me","/api/tickets","/api/invoices","/api/visits","/api/visits/gate/ops","/api/work-hub/home",calendar],
  "vendor_office@gatego.com": ["/api/auth/me","/api/tickets","/api/invoices","/api/visits","/api/visits/gate/ops","/api/work-hub/home",calendar],
  "vendor_gate_supervisor@gatego.com": ["/api/auth/me","/api/visits/gate/assigned-sites","/api/work-hub/home","/api/work-hub/tasks",calendar,"/api/work-hub/channels"],
  "vendor_gatekeeper@gatego.com": ["/api/auth/me","/api/visits/gate/assigned-sites","/api/work-hub/home","/api/work-hub/tasks",calendar,"/api/work-hub/channels"],
};

async function login(username: string) {
  const response = await fetch(`${BASE}/api/auth/login`, { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({username,password:PASSWORD}) });
  if (!response.ok) throw new Error(`${username} login ${response.status}`);
  const cookie = response.headers.get("set-cookie")?.match(/vndrly_session=[^;]+/)?.[0];
  if (!cookie) throw new Error(`${username} login returned no session`);
  return cookie;
}

async function main() {
  const failures: string[]=[];
  let passed=0;
  for (const [username,paths] of Object.entries(roles)) {
    const cookie=await login(username);
    for (const path of paths) {
      const response=await fetch(`${BASE}${path}`,{headers:{cookie}});
      if (response.status !== 200) failures.push(`${username} ${path} -> ${response.status} ${(await response.text()).slice(0,160)}`);
      else passed++;
    }
  }
  console.log(JSON.stringify({passed,failed:failures.length,failures},null,2));
  if (failures.length) process.exitCode=2;
}
main().catch((error)=>{console.error(error);process.exitCode=1;});
