import {beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({records:new Map<string,string>(),files:new Map<string,Uint8Array>(),api:vi.fn(),fetch:vi.fn(),epoch:0,token:null as null|(()=>void),uuid:0,fail:"",camera:vi.fn(),copy:vi.fn(),deleted:[] as string[]}));
vi.mock("expo-secure-store",()=>({WHEN_UNLOCKED_THIS_DEVICE_ONLY:"device-only",getItemAsync:async(k:string)=>mocks.records.get(k)??null,setItemAsync:async(k:string,v:string)=>{if(mocks.fail&&k.endsWith(mocks.fail))throw new Error("Interrupted device write");mocks.records.set(k,v);},deleteItemAsync:async(k:string)=>{mocks.records.delete(k);}}));
vi.mock("expo-image-picker",()=>({MediaTypeOptions:{Images:"images"},requestCameraPermissionsAsync:async()=>({status:"granted"}),requestMediaLibraryPermissionsAsync:async()=>({status:"granted"}),launchCameraAsync:mocks.camera,launchImageLibraryAsync:mocks.camera}));
vi.mock("expo-file-system/legacy",()=>({cacheDirectory:"file:///cache/",copyAsync:async({from,to}:any)=>{mocks.copy(from,to);mocks.files.set(to,mocks.files.get(from)!);},deleteAsync:async(uri:string)=>{mocks.deleted.push(uri);mocks.files.delete(uri);}}));
vi.mock("expo-file-system",()=>({File:class{uri:string;constructor(uri:string){this.uri=uri;}get size(){return mocks.files.get(this.uri)?.byteLength??0;}async bytes(){const bytes=mocks.files.get(this.uri);if(!bytes)throw new Error("Missing cache file");return bytes;}}}));
vi.mock("expo-crypto",()=>({CryptoDigestAlgorithm:{SHA256:"SHA256"},digest:async()=>new Uint8Array(32).fill(170).buffer,randomUUID:()=>`10000000-0000-4000-8000-${String(++mocks.uuid).padStart(12,"0")}`}));
vi.mock("./api",()=>({apiFetch:mocks.api,getApiBase:()=>"https://vndrly.ai"}));
vi.mock("./auth",()=>({captureAuthScope:()=>({generation:mocks.epoch}),isAuthScopeCurrent:(s:any)=>s.generation===mocks.epoch,subscribeToken:(fn:()=>void)=>{mocks.token=fn;},subscribeUser:()=>{}}));
import {captureFleetEvidence,submitFleetEvidencePending,readFleetEvidencePending,clearFleetEvidencePending,fleetPrivateUploadUrl} from "./fleet-evidence-device-native";
const account={userId:1,companyId:609,membershipId:4,sessionVersion:0};
const run:any={id:"20000000-0000-4000-8000-000000000001",companyId:609,driverUserId:1,vehicleAssetId:"30000000-0000-4000-8000-000000000001",trailerAssetId:null,status:"acknowledged",version:4};
const upload={uploadURL:"https://vndrly.ai/api/storage/upload/70000000-0000-4000-8000-000000000001?expires=synthetic&signature=synthetic",objectPath:"/objects/uploads/70000000-0000-4000-8000-000000000001"};
let saved:any[]=[];
function api(path:string,options?:any){if(path.endsWith("overview"))return {accountScope:account,capabilities:{canDrive:true}};if(path.endsWith("/evidence")){if(!options?.method)return {runId:run.id,evidence:saved};const body=JSON.parse(options.body),record={...body,runId:run.id,companyId:609,runVersion:5,size:3,contentType:"image/jpeg",sha256:"a".repeat(64),recordedByUserId:1,recordedAt:"2026-10-07T12:00:00Z",capturedAt:body.capturedAt??null,stopId:null,loadId:null,source:"device_upload",physicalProofVerified:false,signatureIdentityVerified:false,fileUrl:`/api/fleet/runs/${run.id}/evidence/${body.evidenceId}/file`};saved.push(record);return record;}if(path.endsWith("request-url"))return upload;if(path.endsWith("finalize"))return {};return run;}
beforeEach(async()=>{mocks.fail="";await clearFleetEvidencePending();mocks.records.clear();mocks.files.clear();mocks.files.set("file:///camera/image.jpg",new Uint8Array([255,216,255]));mocks.camera.mockReset().mockResolvedValue({canceled:false,assets:[{uri:"file:///camera/image.jpg",mimeType:"image/jpeg"}]});mocks.api.mockReset().mockImplementation(api);mocks.fetch.mockReset().mockImplementation(async(url,options)=>options?{ok:true}:{blob:async()=>new Blob([new Uint8Array([255,216,255])],{type:"image/jpeg"})});vi.stubGlobal("fetch",mocks.fetch);mocks.copy.mockReset();mocks.deleted=[];saved=[];});
it("copies picker-selected bytes into an owned cache file and claims saved only after immutable server association",async()=>{
 const value=await captureFleetEvidence(account,run,{kind:"signature",notes:"Synthetic supplied image"},"camera");expect(value?.asset.sha256).toBe("a".repeat(64));expect(saved).toEqual([]);expect(mocks.api.mock.calls.some(call=>call[0].endsWith("/evidence")&&call[1])).toBe(false);
 const result=await submitFleetEvidencePending();expect(result.signatureIdentityVerified).toBe(false);expect(await readFleetEvidencePending()).toBeNull();expect(mocks.files.has(value!.asset.uri)).toBe(false);expect(mocks.files.has("file:///camera/image.jpg")).toBe(true);
});
it("retains complete encrypted metadata and exact private PUT on an unknown upload response",async()=>{
 await captureFleetEvidence(account,run,{kind:"photo",notes:"Synthetic image"},"camera");mocks.fetch.mockImplementationOnce(async()=>({blob:async()=>new Blob()})).mockImplementationOnce(async()=>{throw new Error("PUT response lost");});
 await expect(submitFleetEvidencePending()).rejects.toThrow("lost");const value=await readFleetEvidencePending();expect(value?.upload).toEqual(upload);expect(value?.uploaded).toBe(false);
 const first=mocks.fetch.mock.calls.find(call=>call[1]);await submitFleetEvidencePending();expect(mocks.api.mock.calls.filter(call=>call[0].endsWith("request-url"))).toHaveLength(1);expect(mocks.fetch.mock.calls.filter(call=>call[1]).at(-1)![0]).toBe(first![0]);
});
it("preserves the prior generation after an interrupted reservation publication",async()=>{
 const first=await captureFleetEvidence(account,run,{kind:"photo",notes:"中".repeat(2000)},"camera");mocks.fail=".meta";
 await expect(submitFleetEvidencePending()).rejects.toThrow("Interrupted");expect(await readFleetEvidencePending()).toEqual(first);mocks.fail="";await clearFleetEvidencePending();expect(mocks.records.size).toBe(0);expect(mocks.files.has(first!.asset.uri)).toBe(false);
});
it("clears every encrypted chunk and only the owned captured file on account mutation",async()=>{
 const value=await captureFleetEvidence(account,run,{kind:"photo",notes:"Synthetic image"},"camera");mocks.epoch++;mocks.token?.();await clearFleetEvidencePending();expect(mocks.records.size).toBe(0);expect(mocks.files.has(value!.asset.uri)).toBe(false);expect(mocks.files.has("file:///camera/image.jpg")).toBe(true);
});
it("refuses off-origin or mismatched private upload destinations",()=>{
 expect(()=>fleetPrivateUploadUrl("https://external.invalid/api/storage/upload/70000000-0000-4000-8000-000000000001",upload.objectPath,"https://vndrly.ai")).toThrow("destination");
 expect(()=>fleetPrivateUploadUrl("https://vndrly.ai/api/storage/upload/70000000-0000-4000-8000-000000000002",upload.objectPath,"https://vndrly.ai")).toThrow("destination");
});
