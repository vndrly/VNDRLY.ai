let pending:string|null=null;
export function rememberMeetingDestination(path:string){const m=path.match(/^\/work-hub\/meetings?\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);if(m)pending=`/work-hub/meeting/${m[1]}`;}
export function pendingMeetingDestination(){return pending;}
export function clearMeetingDestination(){pending=null;}
