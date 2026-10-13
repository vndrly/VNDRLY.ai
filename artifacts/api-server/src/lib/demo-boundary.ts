import {DEMO_IDENTITIES} from './demo-identities';
const names=new Map<string,(typeof DEMO_IDENTITIES)[number]>(DEMO_IDENTITIES.map(identity=>[identity.username,identity]));
const ids=new Set<number>(DEMO_IDENTITIES.map(identity=>identity.userId));
export function isDemoUserId(userId:number|undefined):boolean{return userId!=null&&ids.has(userId);}
export function demoLoginIdentity(username:unknown){return typeof username==='string'?names.get(username.trim().toLowerCase()):undefined;}
/** Input must already have passed signature and expiry verification. */
export function sessionDatabaseRealm(session:{userId?:number;realm?:unknown}):'production'|'demo'|'invalid'{
 if(session.realm==='demo')return session.userId&&ids.has(session.userId)?'demo':'invalid';
 if(session.realm!=null&&session.realm!=='production')return 'invalid';
 return session.userId&&ids.has(session.userId)?'invalid':'production';
}
const reads=[
 /^\/api\/public-config$/,
 /^\/api\/native-operations\/(status|policy)$/,
 /^\/api\/company-operations$/,
 /^\/api\/fleet\/(overview|map-context|commercial|resources|setup|site-activity|reports|locations|views|maintenance)$/,
 /^\/api\/fleet\/runs\/[^/]+(\/(location-history|review-packet|eta|gate-observations|evidence))?$/,
 /^\/api\/fleet\/site-activity\/\d+$/,
 /^\/api\/fleet\/tickets\/\d+\/plan$/,
 /^\/api\/fleet\/destinations\/recommend$/,
 /^\/api\/gate-change-over\/(coverage-map|map)$/,
 /^\/api\/auth\/me$/,
 /^\/api\/onboarding\/me$/,
 /^\/api\/dashboard\/(summary|awaiting-payment|recent-activity|ticket-stats)$/,
 /^\/api\/(tickets|partners|vendors|site-locations|work-types|vendor-people|vendor-contacts|invoices|assets|site-work-assignments)(\/[^/]+)?(\/(contacts|notes|assignments|qr-code|people-access|line-items|status-history|crew|transitions|unlocks|check-ins|nearby-vendors|site-visit-summary))?$/,
 /^\/api\/notifications(\/(unread-count|preferences))?$/,
 /^\/api\/hotlist\/jobs(\/[^/]+)?(\/(bids|comments))?$/,
 /^\/api\/visits\/gate\/(ops|enabled)$/,
 /^\/api\/gate-change-over\/(stations|active-shift)$/,
 /^\/api\/implementation-a\/assets$/,
 /^\/api\/gate-change-over\/(sites|[^/]+\/(state|history|notes))$/,
 /^\/api\/implementation-a\/trips(\/[^/]+)?$/,
 /^\/api\/work-hub\/(home|tasks|calendar|channels|crews|people|preferences|chats|invitations|activity|audit|required-actions|search|files|admin)$/,
 /^\/api\/work-hub\/(channels|crews)\/[^/]+\/(members|messages|notes|channels)$/,
 /^\/api\/work-hub\/(required-actions\/[^/]+\/[^/]+|calendar\/items\/[^/]+\/[^/]+|search\/items\/[^/]+\/[^/]+)$/,
];
/** Deny unreviewed routes, storage and real provider operations at the boundary. */
export function demoRouteAllowed(method:string,path:string):boolean{
 if(/\/(events|stream|download|token|connect|join|audio|replay)(\/|$)/.test(path))return false;
 if(method==='GET')return reads.some(pattern=>pattern.test(path));
 if(method==='POST'&&path==='/api/gate-report/query')return true;
 if(method==='POST'&&/^\/api\/auth\/(login|logout|switch-context)$/.test(path))return true;
 // These operations write only request-scoped database records. No invitations,
 // shared files, meeting provisioning, device enrollment or financial dispatch.
 return ['POST','PATCH','PUT'].includes(method)&&/^\/api\/work-hub\/(tasks|channels\/[^/]+\/(messages|notes)|required-actions\/[^/]+\/[^/]+)(\/[^/]+)?$/.test(path);
}
