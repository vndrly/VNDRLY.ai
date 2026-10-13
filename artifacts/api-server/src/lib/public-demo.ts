/** Public entry can select only these existing, isolated synthetic identities. */
export const PUBLIC_DEMO_ACCOUNTS = {
  partner: {userId:1081, username:'prairie-demo-office@example.invalid', role:'partner'},
  field: {userId:1084, username:'prairie-demo-field-office@example.invalid', role:'vendor'},
  fleet: {userId:1085, username:'prairie-demo-fleet-office@example.invalid', role:'vendor'},
  gate: {userId:1086, username:'prairie-demo-gate-office@example.invalid', role:'vendor'},
} as const;
export function publicDemoAccount(value:unknown){
  return typeof value==='string'&&Object.hasOwn(PUBLIC_DEMO_ACCOUNTS,value)
    ? PUBLIC_DEMO_ACCOUNTS[value as keyof typeof PUBLIC_DEMO_ACCOUNTS] : undefined;
}
export function publicDemoRequestAllowed(method:string,path:string):boolean{
  return method==='GET'||(method==='POST'&&['/api/auth/logout','/api/auth/demo-entry','/api/gate-report/query'].includes(path));
}
