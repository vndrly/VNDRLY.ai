import {Platform} from 'react-native';
import {apiFetch, apiFetchRaw, getApiBase} from './api';
import {captureAuthScope,isAuthScopeCurrent} from './auth';
import type {MeetingFileSource} from './meeting-files';

export async function uploadCredentialDocument(source:MeetingFileSource='files'):Promise<string|null>{
 const scope=captureAuthScope();
 const current=()=>{if(!isAuthScopeCurrent(scope))throw Error('Account changed. Reopen the form.');};
 let blob:Blob,name:string,type:string;
 if(Platform.OS==='web'){
  const file=await new Promise<globalThis.File|null>(resolve=>{const input=document.createElement('input');input.type='file';input.accept=source==='files'?'image/*,application/pdf':'image/*';input.onchange=()=>resolve(input.files?.[0]??null);input.oncancel=()=>resolve(null);input.click();});
  if(!file)return null;blob=file;name=file.name;type=file.type;
 }else{
  const {pickMeetingFile}=await import('./meeting-files');const file=await pickMeetingFile(source);if(!file)return null;
  blob=new Blob([new Uint8Array(file.bytes).buffer],{type:file.type});name=file.name;type=file.type;
 }
 current();
 if(!type.startsWith('image/')&&type!=='application/pdf')throw Error('Choose a photo or PDF.');
 if(!blob.size||blob.size>10*1024*1024)throw Error('Choose a file smaller than 10 MB.');
 const receipt=await apiFetch<{uploadURL:string;objectPath:string}>('/api/storage/uploads/request-url',{method:'POST',body:JSON.stringify({name,size:blob.size,contentType:type})},scope);
 current();const url=/^https?:\/\//.test(receipt.uploadURL)?receipt.uploadURL:getApiBase().replace(/\/$/,'')+receipt.uploadURL;
 const response=await fetch(url,{method:'PUT',headers:{'Content-Type':type},body:blob});current();if(!response.ok)throw Error('Upload failed.');
 await apiFetch('/api/storage/uploads/finalize',{method:'POST',body:JSON.stringify({objectURL:receipt.uploadURL,visibility:'private'})},scope);current();
 return '/api/storage'+receipt.objectPath;
}
export async function openCredentialDocument(path:string){
 if(!/^\/(?:api\/storage|objects)\//.test(path))throw Error('Invalid document reference.');
 const scope=captureAuthScope(),response=await apiFetchRaw(path,{},scope);
 if(!response.ok)throw Error('Could not open document.');
 const bytes=await response.arrayBuffer();if(!isAuthScopeCurrent(scope))throw Error('Account changed.');
 const type=response.headers.get('content-type')??'application/octet-stream';
 if(Platform.OS==='web'){
  const url=URL.createObjectURL(new Blob([bytes],{type}));const a=document.createElement('a');a.href=url;a.download=type.includes('pdf')?'credential.pdf':'credential-photo';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);return;
 }
 const {File,Paths}=await import('expo-file-system');const Sharing=await import('expo-sharing');
 const file=new File(Paths.cache,`credential-${Date.now()}.${type.includes('pdf')?'pdf':type.includes('png')?'png':'jpg'}`);
 try{file.create();file.write(new Uint8Array(bytes));await Sharing.shareAsync(file.uri,{mimeType:type});}finally{file.delete();}
}
