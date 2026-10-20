import { describe, expect, it } from "vitest";
import { chatGptActionTools, chatGptReadToolAnnotations } from "./chatgpt-tool-access";
import { CHATGPT_READ_CAPABILITIES } from "./chatgpt-read-capabilities";
import { bindWorkHubToolScope, resolveExecutableWorkHubToolRequest } from "./work-hub-tool-runtime";
import { sanitizeChatGptActionInput, validateChatGptActionInput } from "./chatgpt-write-capabilities";
const runId = "11111111-1111-4111-8111-111111111111",
  operationId = "22222222-2222-4222-8222-222222222222";
const session = { userId: 1, role: "vendor", membershipRole: "admin" };
const fleetSession = { ...session, vendorId: 42, activeMembershipId: 9, sv: 3 };
describe("Fleet assistant canonical action boundary", () => {
  it("preserves strict Fleet mobile workflow inputs instead of injecting model-visible company scope", () => {
    const actor = { vendorId: 42, partnerId: null };
    expect(bindWorkHubToolScope({ module: "yard" }, actor, "query_fleet_home")).toEqual({ module: "yard" });
    expect(bindWorkHubToolScope({ limit: 20 }, actor, "query_fleet_yard_orders")).toEqual({ limit: 20 });
    expect(bindWorkHubToolScope({}, actor, "query_fleet_compliance_score")).toEqual({});
    expect(bindWorkHubToolScope({ assetId: runId }, actor, "query_fleet_custody")).toEqual({ assetId: runId });
  });

  it("exposes scoped Fleet workflow reads and confirmation-bound actions without model authority fields", () => {
    for (const name of ["query_fleet_home", "query_fleet_yard_orders", "query_fleet_custody", "query_fleet_compliance_score"])
      expect(CHATGPT_READ_CAPABILITIES["fleet:read"].tools).toContain(name);

    const previousActions = chatGptActionTools(session, ["fleet:dispatch", "fleet:run"]).map((tool) => tool.name);
    expect(previousActions).not.toEqual(expect.arrayContaining(["manage_fleet_yard_order", "record_fleet_custody"]));
    const actions = chatGptActionTools(session, ["fleet:yard"]).map((tool) => tool.name);
    expect(actions).toEqual(expect.arrayContaining(["manage_fleet_yard_order", "record_fleet_custody"]));
    expect(sanitizeChatGptActionInput("record_fleet_custody", {
      assetId: runId,
      companyId: 99,
      observedByUserId: 88,
      scope: { owner: { type: "vendor", id: 99 } },
      operationId,
      confirmed: true,
    })).toEqual({ assetId: runId });
  });

  it("routes canonical Fleet mobile reads without caller-supplied scope", () => {
    expect(resolveExecutableWorkHubToolRequest("query_fleet_home", { module: "driver" }, false, fleetSession)).toEqual({ method: "GET", path: "/fleet/home?module=driver", body: {} });
    expect(resolveExecutableWorkHubToolRequest("query_fleet_yard_orders", { limit: 20 }, false, fleetSession)).toEqual({ method: "GET", path: "/fleet/yard-orders?limit=20", body: {} });
    expect(resolveExecutableWorkHubToolRequest("query_fleet_custody", { assetId: runId, limit: 10 }, false, fleetSession)).toEqual({ method: "GET", path: `/fleet/custody?assetId=${runId}&limit=10`, body: {} });
    expect(resolveExecutableWorkHubToolRequest("query_fleet_compliance_score", {}, false, fleetSession)).toEqual({ method: "GET", path: "/fleet/compliance-score", body: {} });
    expect(resolveExecutableWorkHubToolRequest("query_fleet_compliance_score", { companyId: 99 }, false, fleetSession)).toHaveProperty("error");
  });

  it("binds Yard and custody actions to the signed membership and one recoverable operation identity", () => {
    const yard = { orderId: runId, expectedVersion: 2, kind: "report", outcome: "ready", notes: "Rigging verified", operationId };
    expect(resolveExecutableWorkHubToolRequest("manage_fleet_yard_order", yard, false, fleetSession)).toMatchObject({ requiresConfirmation: true });
    expect(resolveExecutableWorkHubToolRequest("manage_fleet_yard_order", yard, true, fleetSession)).toMatchObject({
      method: "POST",
      path: `/fleet/yard-orders/${runId}/actions`,
      body: { operationId, expectedVersion: 2, orderId: runId, kind: "report", outcome: "ready", scope: { owner: { type: "vendor", id: 42 }, userId: 1, membershipId: 9, sessionVersion: 3 } },
    });

    const custody = { expectedVersion: 1, assetId: runId, state: "at_yard", method: "driver_app", observedAt: "2026-10-20T12:00:00.000Z", latitude: 35.2, longitude: -97.4, operationId, companyId: 99, observedByUserId: 88 };
    expect(resolveExecutableWorkHubToolRequest("record_fleet_custody", custody, true, fleetSession)).toMatchObject({
      method: "POST",
      path: "/fleet/custody/operations",
      body: { operationId, observation: { companyId: 42, observedByUserId: 1, assetId: runId, latitude: 35.2, longitude: -97.4 } },
    });
    expect(resolveExecutableWorkHubToolRequest("record_fleet_custody", { ...custody, longitude: null }, true, fleetSession)).toHaveProperty("error");
    expect(resolveExecutableWorkHubToolRequest("record_fleet_custody", custody, true, { ...fleetSession, activeMembershipId: null })).toHaveProperty("error");
  });

  it("validates exact Yard and custody prepared-action shapes before approval", () => {
    expect(() => validateChatGptActionInput("manage_fleet_yard_order", { orderId: runId, expectedVersion: 2, kind: "start", operationId })).not.toThrow();
    expect(() => validateChatGptActionInput("manage_fleet_yard_order", { orderId: runId, expectedVersion: -1, kind: "start", operationId })).toThrow();
    expect(() => validateChatGptActionInput("record_fleet_custody", { expectedVersion: 1, assetId: runId, state: "at_yard", method: "manual", observedAt: "2026-10-20T12:00:00.000Z", latitude: 35.2, operationId })).toThrow();
  });
  it("keeps cargo dispatch and own-driver consent families separate", () => {
    const dispatch=chatGptActionTools(session,["fleet:dispatch"]).map(tool=>tool.name),driver=chatGptActionTools(session,["fleet:run"]).map(tool=>tool.name);
    expect(dispatch).toContain("prepare_fleet_cargo_transfer");expect(dispatch).toContain("complete_fleet_cargo_transfer");expect(dispatch).not.toContain("acknowledge_fleet_cargo_source");
    expect(driver).toContain("acknowledge_fleet_cargo_source");expect(driver).toContain("acknowledge_fleet_cargo_recipient");expect(driver).not.toContain("complete_fleet_cargo_transfer");
    expect(chatGptActionTools({...session,role:"partner"},["fleet:dispatch","fleet:run"]).some(tool=>tool.name.includes("cargo"))).toBe(false);
    expect(chatGptActionTools(session,[]).some(tool=>tool.name.includes("cargo"))).toBe(false);
  });
  it("pins each cargo acknowledgement to its named operation and retains trusted confirmation", () => {
    const input={transferId:runId,operationId,expectedVersion:1,sourceExpectedVersion:4,targetExpectedVersion:4,notes:"Actual user acknowledgement",actorUserId:99};
    for(const [name,action] of [["acknowledge_fleet_cargo_source","acknowledge_source"],["acknowledge_fleet_cargo_recipient","acknowledge_target"],["complete_fleet_cargo_transfer","complete"],["cancel_fleet_cargo_transfer","cancel"]]){
      expect(resolveExecutableWorkHubToolRequest(name,input,false,session)).toMatchObject({requiresConfirmation:true});
      const request=resolveExecutableWorkHubToolRequest(name,input,true,session);
      expect(request).toMatchObject({method:"POST",path:`/fleet/cargo-transfers/${runId}/actions`,body:{action}});
      expect(request && "body" in request && request.body).not.toHaveProperty("actorUserId");
      expect(resolveExecutableWorkHubToolRequest(name,{...input,action:"invented"},true,session)).toHaveProperty("error");
    }
  });
  it("keeps every scheduled-service and saved-view variant executable and refuses unknown variants", () => {
    const assetId="33333333-3333-4333-8333-333333333333";
    expect(resolveExecutableWorkHubToolRequest("manage_fleet_maintenance",{action:"create",operationId,fleetId:assetId,assetId,title:"Scheduled",notes:"Actual schedule"},true,session)).toMatchObject({method:"POST",path:"/fleet/maintenance"});
    for(const action of ["triage","record_repair","release","cancel"])
      expect(resolveExecutableWorkHubToolRequest("manage_fleet_maintenance",{action,operationId,maintenanceId:assetId,expectedVersion:1,notes:"Actual user action"},true,session)).toMatchObject({method:"POST",path:`/fleet/maintenance/${assetId}/actions`});
    expect(resolveExecutableWorkHubToolRequest("manage_fleet_maintenance",{action:"invented",operationId},true,session)).toHaveProperty("error");
    expect(resolveExecutableWorkHubToolRequest("manage_fleet_saved_view",{action:"save",operationId,name:"Actual filter",filters:{}},true,session)).toMatchObject({method:"POST",path:"/fleet/views"});
    expect(resolveExecutableWorkHubToolRequest("manage_fleet_saved_view",{action:"archive",operationId,viewId:assetId,expectedVersion:1},true,session)).toMatchObject({method:"POST",path:"/fleet/views"});
    expect(resolveExecutableWorkHubToolRequest("manage_fleet_saved_view",{action:"invented",operationId},true,session)).toHaveProperty("error");
  });
  it("prepares only exact draft edits through trusted confirmation and retains structured facts", () => {
    const input={runId,operationId,expectedVersion:1,title:"Actual edit",schedule:{plannedStartAt:"2026-10-08T12:00:00Z",plannedEndAt:"2026-10-08T20:00:00Z",timezone:"America/Chicago"},ownerUserId:99};
    expect(resolveExecutableWorkHubToolRequest("edit_fleet_draft",input,false,session)).toMatchObject({requiresConfirmation:true});
    expect(resolveExecutableWorkHubToolRequest("edit_fleet_draft",input,true,session)).toMatchObject({method:"PATCH",path:`/fleet/runs/${runId}/draft`,body:{title:"Actual edit",schedule:input.schedule}});
    expect(resolveExecutableWorkHubToolRequest("edit_fleet_draft",{runId,operationId,expectedVersion:1},true,session)).toHaveProperty("error");
    expect(()=>validateChatGptActionInput("edit_fleet_draft",input)).not.toThrow();
  });
  it("routes ETA exact run reads without accepting coordinates and declares external provider", () => {
    expect(resolveExecutableWorkHubToolRequest("query_fleet_run_eta", {runId, latitude: 99}, false, session)).toMatchObject({method:"GET", path:`/fleet/runs/${runId}/eta`});
    expect(resolveExecutableWorkHubToolRequest("query_fleet_run_eta", {}, false, session)).toHaveProperty("error");
    expect(chatGptReadToolAnnotations("query_fleet_run_eta")).toMatchObject({readOnlyHint:true,openWorldHint:true});
  });
  it("keeps new maintenance/view/Gate commands bound and excludes authority overrides", () => {
    const maintenanceId = "33333333-3333-4333-8333-333333333333";
    expect(
      resolveExecutableWorkHubToolRequest(
        "manage_fleet_maintenance",
        {
          maintenanceId,
          action: "release",
          expectedVersion: 2,
          notes: "Authorized user review",
          operationId,
          confirmed: true,
          safetyRelease: true,
        },
        false,
        session,
      ),
    ).toMatchObject({ requiresConfirmation: true });
    expect(
      resolveExecutableWorkHubToolRequest(
        "manage_fleet_maintenance",
        {
          maintenanceId,
          action: "release",
          expectedVersion: 2,
          notes: "Authorized user review",
          operationId,
          safetyRelease: true,
          ownerId: 88,
        },
        true,
        session,
      ),
    ).toMatchObject({
      method: "POST",
      path: `/fleet/maintenance/${maintenanceId}/actions`,
      body: {
        operationId,
        expectedVersion: 2,
        action: "release",
        notes: "Authorized user review",
      },
    });
    const gate = resolveExecutableWorkHubToolRequest(
      "reconcile_fleet_gate_visit",
      {
        runId,
        stopId: maintenanceId,
        visitId: 7,
        expectedVersion: 3,
        operationId,
        reason: "Selected actual candidate",
        actorUserId: 99,
        confirmed: true,
      },
      true,
      session,
    );
    expect(gate).toMatchObject({
      path: `/fleet/runs/${runId}/gate-links`,
      body: {
        operationId,
        expectedVersion: 3,
        stopId: maintenanceId,
        visitId: 7,
        reason: "Selected actual candidate",
      },
    });
    if (gate && "body" in gate) expect(gate.body).not.toHaveProperty("actorUserId");
    expect(
      resolveExecutableWorkHubToolRequest(
        "query_fleet_report",
        {
          siteId: 9,
          startsAt: "2026-10-06T00:00:00Z",
          endsAt: "2026-10-07T00:00:00Z",
        },
        false,
        session,
      ),
    ).toMatchObject({ method: "GET" });
    expect(() =>
      validateChatGptActionInput("manage_fleet_maintenance", {
        maintenanceId,
        action: "release",
        notes: "Missing revision",
      }),
    ).toThrow();
  });
  it("forwards only validated historical pagination through canonical reads", () => {
    expect(
      resolveExecutableWorkHubToolRequest(
        "query_fleet_runs",
        { limit: 25, cursor: "120:70" },
        false,
        session,
      ),
    ).toMatchObject({
      method: "GET",
      path: "/fleet/overview?limit=25&cursor=120%3A70",
    });
    expect(
      resolveExecutableWorkHubToolRequest(
        "query_fleet_briefing",
        { cursor: "//foreign" },
        false,
        session,
      ),
    ).toHaveProperty("error");
    expect(
      resolveExecutableWorkHubToolRequest(
        "query_fleet_runs",
        { limit: 51 },
        false,
        session,
      ),
    ).toHaveProperty("error");
  });
  it("requires trusted authorization and cannot turn dispatch consent into driver transition", () => {
    expect(
      resolveExecutableWorkHubToolRequest(
        "manage_fleet_run",
        {
          runId,
          operationId,
          expectedVersion: 1,
          action: "dispatch",
          confirmed: true,
        },
        false,
        session,
      ),
    ).toMatchObject({ requiresConfirmation: true });
    expect(
      resolveExecutableWorkHubToolRequest(
        "manage_fleet_run",
        { runId, operationId, expectedVersion: 1, action: "start" },
        true,
        session,
      ),
    ).toHaveProperty("error");
    expect(() =>
      validateChatGptActionInput("manage_fleet_run", {
        runId,
        expectedVersion: 1,
        action: "start",
      }),
    ).toThrow();
  });
  it("uses the canonical action envelope and excludes scope/confirmation overrides", () => {
    expect(
      resolveExecutableWorkHubToolRequest(
        "transition_fleet_run",
        {
          runId,
          operationId,
          expectedVersion: 3,
          action: "pause",
          reason: "Actual wait",
          owner: { id: 99 },
          confirmed: true,
          latitude: 35,
          idempotencyKey: "model",
        },
        true,
        session,
      ),
    ).toEqual({
      method: "POST",
      path: "/fleet/runs/" + runId + "/actions",
      body: {
        operationId,
        expectedVersion: 3,
        action: "pause",
        reason: "Actual wait",
      },
    });
  });
  it("refuses resource-path traversal before constructing a request", () => {
    expect(
      resolveExecutableWorkHubToolRequest(
        "query_fleet_run_detail",
        { runId: "../../users" },
        false,
        session,
      ),
    ).toHaveProperty("error");
  });
  it("keeps configuration changes restricted to company admin and validates the exact versioned schema", () => {
    expect(
      resolveExecutableWorkHubToolRequest(
        "manage_fleet_settings",
        { expectedVersion: 1, enabled: true, fleets: [], grants: [] },
        true,
        { userId: 1, role: "vendor", membershipRole: "member" },
      ),
    ).toHaveProperty("error");
    expect(
      resolveExecutableWorkHubToolRequest(
        "manage_fleet_settings",
        {
          expectedVersion: 1,
          enabled: true,
          fleets: [],
          grants: [],
          owner: { id: 99 },
        },
        true,
        session,
      ),
    ).toEqual({
      method: "POST",
      path: "/fleet/setup",
      body: { expectedVersion: 1, enabled: true, fleets: [], grants: [] },
    });
  });
});
