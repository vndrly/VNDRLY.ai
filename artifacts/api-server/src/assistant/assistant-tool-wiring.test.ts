import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ASKV_SERVER_CLIENT_INTENT_NAMES, isClientTool } from "./client-tools";
import { isDataTool } from "./data-tools";
import { ASK_V_TOOL_REGISTRY } from "./tool-registry";
import { isWriteTool } from "./write-tools";
import { resolveWorkHubToolMetadata } from "./work-hub-tool-runtime";

describe("AskV advertised tool wiring", () => {
  const readIntentCatalog = (url: URL, exportName: string) => {
    const source = readFileSync(url, "utf8");
    const body = source.match(new RegExp(`${exportName}\\s*=\\s*Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\)`))?.[1] ?? "";
    return [...body.matchAll(/["']([a-z_]+)["']/g)].map((match) => match[1]);
  };

  it("keeps every server-emitted client intent implemented on web and native", () => {
    const web = readIntentCatalog(new URL("../../../vndrly/src/lib/askv-client-intents.ts", import.meta.url), "ASKV_WEB_CLIENT_INTENT_NAMES");
    const native = readIntentCatalog(new URL("../../../vndrly-mobile/lib/askv-client-tools.ts", import.meta.url), "ASKV_NATIVE_CLIENT_INTENT_NAMES");
    const server = [...ASKV_SERVER_CLIENT_INTENT_NAMES].sort();
    expect(web.sort()).toEqual(server);
    expect(native.sort()).toEqual(server);
  });

  it("routes every advertised server tool to an executable handler", () => {
    const routeSource = readFileSync(new URL("../routes/assistant.ts", import.meta.url), "utf8");
    const missing = ASK_V_TOOL_REGISTRY
      .filter((tool) => tool.execution !== "client")
      .map((tool) => tool.name)
      .filter((name) => {
        if (resolveWorkHubToolMetadata(name) || isDataTool(name) || isWriteTool(name) || isClientTool(name)) return false;
        return !routeSource.includes(`case "${name}"`) && !routeSource.includes(`name === "${name}"`);
      });
    expect(missing).toEqual([]);
  });

  it("requires confirmation for every typed or high-risk mutation", () => {
    const unsafe = ASK_V_TOOL_REGISTRY.filter(
      (tool) => tool.mutating && tool.risk === "high" && tool.confirmation !== "required",
    ).map((tool) => tool.name);
    expect(unsafe).toEqual([]);
  });

  it("keeps every advertised action variant connected to a runtime branch", () => {
    const routeSource = readFileSync(new URL("../routes/assistant.ts", import.meta.url), "utf8");
    const workHubRuntime = readFileSync(new URL("./work-hub-tool-runtime.ts", import.meta.url), "utf8");
    const missing = ASK_V_TOOL_REGISTRY.flatMap((tool) => {
      const actionSchema = (tool.inputSchema.properties as Record<string, { enum?: unknown[] }> | undefined)?.action;
      const actions = Array.isArray(actionSchema?.enum) ? actionSchema.enum.filter((value): value is string => typeof value === "string") : [];
      const source = tool.name === "propose_work_hub_action" ? routeSource : workHubRuntime;
      return actions.filter((action) =>
        !source.includes(`"${action}"`) &&
        !source.includes(`'${action}'`) &&
        !new RegExp(`\\b${action}\\s*:`).test(source),
      )
        .map((action) => `${tool.name}:${action}`);
    });
    expect(missing).toEqual([]);
  });
});
