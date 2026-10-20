import {captureAuthScope,isAuthScopeCurrent} from "./auth";
import {getDeviceId} from "./deviceId";
import {acceptConsent,hasActiveConsentForThisDevice} from "./locationConsent";
import {readNativeOperations,updateNativeConsent,designateNativeWorkPhone} from "./native-operations";
/** Called only from the driver's explicit location-consent acceptance. */
export async function enableFleetRunLocation(){
 const scope=captureAuthScope();
 const check=()=>{if(!isAuthScopeCurrent(scope))throw new Error("Account changed. Reopen location setup.");};
 const status=await readNativeOperations(scope),deviceId=await getDeviceId();check();
 if(status.designatedDeviceId&&status.designatedDeviceId!==deviceId)throw new Error("Use your designated work phone or select this phone in Profile.");
 const accepted=await hasActiveConsentForThisDevice();check();
 if(!accepted){await acceptConsent();check();}
 await updateNativeConsent(true);check();
 if(!status.designatedDeviceId)await designateNativeWorkPhone();
 check();
}
