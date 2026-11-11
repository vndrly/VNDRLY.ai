import { describe, expect, it } from "vitest";
import { requestOpenAIVRound } from "../cooperative-v-providers";
import { buildSystemPrompt } from "../prompts/system";
import { toolsForRealtime } from "../tool-packs";

// Real model + production page tool pack. No domain writes are executed here;
// authenticated execution and saved outcomes are covered separately.
const cases = [
  { path: "/gate", prompt: "Open Sand Roman Completions 2 on the Gate Map", tool: "open_screen", args: {screen:"gate-map"} },
  { path: "/gate", prompt: "Which gate stations can I access?", tool: "query_gate_stations" },
  { path: "/work-hub/tasks", prompt: "Read my Work Hub tasks and tell me what is outstanding.", tool: "list_work_hub_tasks" },
  { path: "/work-hub/channels", prompt: "List the Work Hub channels I can access.", tool: "list_work_hub_channels" },
  { path: "/work-hub/files", prompt: "Find my Work Hub documents containing handoff.", tool: "list_work_hub_files" },
  { path: "/work-hub/search", prompt: "Search Work Hub for compressor.", tool: "search_work_hub" },
  { path: "/work-hub/meetings", prompt: "List my company's live meetings.", tool: "list_live_meetings" },
  { path: "/work-hub/settings", prompt: "Read my current Work Hub settings.", tool: "get_work_hub_settings" },
] as const;

describe.skipIf(!process.env.OPENAI_API_KEY)("Ask V workflow selection through production page packs", () => {
  for (const example of cases) it(example.prompt, async () => {
    const pack = toolsForRealtime({role:"vendor",membershipRole:"admin",path:example.path});
    expect(pack.some(t=>t.name===example.tool), `Missing capability on ${example.path}`).toBe(true);
    const system = buildSystemPrompt({
      user:{userId:1,role:"vendor",displayName:"Synthetic reviewer",vendorId:1,partnerId:null,preferredLanguage:"en"},
      docs:[],pageContext:{path:example.path},
      onboarding:{active:false,orgType:"vendor",currentStep:null,completedSteps:[],skippedSteps:[]},
    });
    const result = await requestOpenAIVRound({system,messages:[{role:"user",content:example.prompt}],
      tools:pack.map(t=>({name:t.name,description:t.description,input_schema:t.inputSchema})),maxTokens:2048,
    },{apiKey:process.env.OPENAI_API_KEY!});
    const call=result.content.find(b=>b.type==="tool_use" && b.name===example.tool);
    expect(call, JSON.stringify(result.content)).toBeTruthy();
    if (call?.type==="tool_use" && "args" in example) expect(call.input).toMatchObject(example.args);
    if (call?.type==="tool_use" && example.tool==="open_screen") {
      expect((call.input as {query?:string}).query).toMatch(/roman/i);
    }
  },120_000);
});
