import {it,expect} from "vitest";
import {workspaceRequest,workspaceOutput,WORKSPACE_HTML} from "./chatgpt-workspace";
it("renders canonical device states without describing uploads or stale results as saved evidence",()=>{
 const request=workspaceRequest({view:"native_work"});
 expect(request).toEqual({view:"native_work",sourceTool:"query_native_work_status",sourceArguments:{}});
 const result=workspaceOutput(request.view,request.sourceTool,{}, {policy:{enabled:true},duty:{active:false},consent:{locationSharing:false},designatedDeviceId:null,requests:[{purpose:"Review pump",kind:"photo",state:"upload-in-progress",ticketId:42},{purpose:"Location",kind:"location",state:"unavailable",lastKnown:{latitude:1,longitude:2}}]});
 expect(result.sections[1].rows[0].detail).toContain("upload in progress");
 expect(JSON.stringify(result)).not.toContain("latitude");
 expect(result.sections[0].rows[0].title).toBe("Off duty");
 expect(WORKSPACE_HTML).toContain('data-view="native_work"');
 expect(()=>workspaceOutput(request.view,request.sourceTool,{}, {policy:{enabled:true},duty:{active:false}})).toThrow("unavailable");
});
