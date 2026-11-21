import { expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({model:vi.fn(),stored:undefined as any,write:vi.fn(),transaction:vi.fn()}));
vi.mock("../assistant/openai-text",()=>({requestOpenAIText:mocks.model}));
vi.mock("@workspace/db",()=>({
 workHubMeetingArtifactsTable:{occurrenceId:"occurrenceId",artifactType:"artifactType",id:"id"},
 db:{transaction:mocks.transaction},
}));
import { scheduleMeetingRecap } from "./meeting-live-recap-worker";
it("generates once per new batch, persists it, and ignores processed sources",async()=>{
 mocks.model.mockResolvedValue({content:[{type:"text",text:JSON.stringify({summary:"Alex will confirm delivery.",actionItems:[],decisions:[]})}]});
 mocks.transaction.mockImplementation(async(fn:any)=>fn({execute:vi.fn(),select:()=>({from:()=>({where:async()=>mocks.stored?[mocks.stored]:[]})}),insert:()=>({values:async(v:any)=>{mocks.stored=v;mocks.write(v);}})}));
 const source={id:"public1",text:"I will confirm delivery.",speaker:"Alex",time:1};
 const error=vi.fn();
 scheduleMeetingRecap("test-live",null,[source],error);
 scheduleMeetingRecap("test-live",null,[source],error);
 await vi.waitFor(()=>expect(mocks.write).toHaveBeenCalledTimes(1));
 expect(mocks.stored.metadata.summary).toBe("Alex will confirm delivery.");
 scheduleMeetingRecap("test-live",mocks.stored.metadata,[source],error);
 expect(mocks.model).toHaveBeenCalledTimes(1);expect(error).not.toHaveBeenCalled();
});
it("does not overwrite a newer persisted revision",async()=>{
 mocks.write.mockClear();
 mocks.stored={id:"existing",metadata:{version:5}};
 scheduleMeetingRecap("test-race",null,[{id:"race",text:"An update",speaker:"Alex",time:1}],vi.fn());
 await vi.waitFor(()=>expect(mocks.transaction).toHaveBeenCalledTimes(2));
 expect(mocks.write).not.toHaveBeenCalled();
});
