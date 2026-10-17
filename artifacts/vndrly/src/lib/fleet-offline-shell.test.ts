import {it,expect,vi} from "vitest";
import {provisionFleetOfflineShell} from "./fleet-offline-shell";
it("refuses an overlapping root worker and never claims browser durability without persistence and an acknowledged shell",async()=>{
 Object.defineProperty(navigator,"storage",{value:{persist:async()=>true,persisted:async()=>true},configurable:true});
 const register=vi.fn();Object.defineProperty(navigator,"serviceWorker",{value:{getRegistrations:async()=>[{scope:`${location.origin}/`,active:{scriptURL:`${location.origin}/other-worker.js`}}],register},configurable:true});
 expect(await provisionFleetOfflineShell({production:true})).toMatchObject({status:"unavailable"});expect(register).not.toHaveBeenCalled();
 Object.defineProperty(navigator,"storage",{value:{persist:async()=>false,persisted:async()=>false},configurable:true});expect(await provisionFleetOfflineShell({production:true})).toMatchObject({status:"unavailable"});expect(register).not.toHaveBeenCalled();
});
