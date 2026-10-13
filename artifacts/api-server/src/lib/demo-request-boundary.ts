import type {Request,Response,NextFunction} from 'express';
import {initializeDemoDatabase,runInDatabaseRealm} from '@workspace/db';
import {decodeSession,getSessionFromRequest} from './session';
import {demoLoginIdentity,sessionDatabaseRealm,demoRouteAllowed} from './demo-boundary';
import {publicDemoRequestAllowed} from './public-demo';

/** Installed before assistant credentials, session guards and all database reads. */
export async function demoRequestBoundary(req:Request,res:Response,next:NextFunction):Promise<void>{
 const bearer=req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
 const cookieSession=getSessionFromRequest(req);
 const bearerSession=decodeSession(bearer);
 const sessions=[cookieSession,bearerSession].filter(Boolean);
 const realms=sessions.map(s=>sessionDatabaseRealm(s!));
 const isPublicEntry=req.method==='POST'&&req.path==='/api/auth/demo-entry';
 const isLogin=req.method==='POST'&&req.path==='/api/auth/login';
 if(req.method==='POST'&&req.path==='/api/auth/logout'&&sessions.some(s=>s?.publicDemo)){
  res.clearCookie('vndrly_session',{path:'/'});res.json({ok:true});return;
 }
 if(req.method==='POST'&&req.path==='/api/auth/logout'&&realms.includes('invalid')){
  res.clearCookie('vndrly_session',{path:'/'});res.json({ok:true});return;
 }
 if(!isLogin&&!isPublicEntry&&(realms.includes('invalid')||new Set(realms).size>1)){res.status(401).json({code:'auth.session_invalidated',message:'Sign in again to the isolated demo'});return;}
 const realm=isPublicEntry?'demo':isLogin?(demoLoginIdentity(req.body?.username)?'demo':'production'):realms[0]??'production';
 if(realm==='production'){runInDatabaseRealm('production',next);return;}
 if((!isLogin&&sessions.some(s=>s?.publicDemo)&&!publicDemoRequestAllowed(req.method,req.path))||(!isPublicEntry&&!demoRouteAllowed(req.method,req.path))){
  res.status(403).json({code:'demo.operation_disabled',message:'This operation is disabled in the isolated demo. No live messages, payments, integrations or shared files are used.'});return;
 }
 try{await initializeDemoDatabase();runInDatabaseRealm('demo',next);}
 catch{res.status(503).json({code:'demo.unavailable',message:'The isolated demo is temporarily unavailable. Production access is not used as a fallback.'});}
}
